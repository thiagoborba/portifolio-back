import { Octokit } from '@octokit/rest';
import { codeToHtml } from 'shiki';

/**
 * Sanitizes HTML produced by Shiki's codeToHtml().
 *
 * Shiki's output is a narrow, predictable structure:
 *   <pre class="shiki ..."><code><span class="line"><span style="color:#...">TOKEN</span></span></code></pre>
 *
 * The only tags ever emitted are <pre>, <code>, and <span>.
 * The only attributes ever used are `class` and `style`.
 *
 * This function enforces that contract as a defence-in-depth layer against:
 *   - A future Shiki regression that emits unexpected markup.
 *   - A supply-chain compromise of the shiki package.
 *   - Unexpected characters in GitHub file content escaping the tokeniser.
 *
 * Strategy: strip every HTML tag that is not in the known-good allow-list,
 * and strip every attribute that is not `class` or `style`.
 */
function sanitizeShikiHtml(html: string): string {
  const ALLOWED_TAGS = new Set(['pre', 'code', 'span']);

  // Remove any tag whose name is not in the allow-list (including closing tags).
  // This catches <script>, <img>, <a>, etc.
  const withoutForbiddenTags = html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g,
    (fullMatch, tagName: string) => {
      if (ALLOWED_TAGS.has(tagName.toLowerCase())) {
        return fullMatch; // keep allowed tags — attributes are filtered next
      }
      return ''; // strip disallowed tags entirely
    },
  );

  // Within remaining allowed tags, strip every attribute except `class` and `style`.
  // This eliminates event handlers (on*), href, src, data-*, etc.
  const withSafeAttributes = withoutForbiddenTags.replace(
    /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (_fullMatch, tagName: string, rawAttrs: string) => {
      // Extract only class="..." and style="..." attributes.
      const safeAttrs: string[] = [];

      const attrPattern = /\b(class|style)=("[^"]*"|'[^']*')/g;
      let m: RegExpExecArray | null;
      while ((m = attrPattern.exec(rawAttrs)) !== null) {
        safeAttrs.push(`${m[1]}=${m[2]}`);
      }

      const attrStr = safeAttrs.length > 0 ? ` ${safeAttrs.join(' ')}` : '';
      return `<${tagName}${attrStr}>`;
    },
  );

  return withSafeAttributes;
}

export type Snippet = {
  repo: string;
  filename: string;
  html: string;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  githubUrl: string;
  technologies: string[];
  language: string | null;
  stars: number;
  updatedAt: string;
  homepage: string | null;
};

const REPOS = [
  { owner: 'thiagoborba', repo: 'portifolio-front' },
  { owner: 'thiagoborba', repo: 'portifolio-back' },
  { owner: 'thiagoborba', repo: 'briefing2task-front' },
  { owner: 'thiagoborba', repo: 'design-system' },
  { owner: 'thiagoborba', repo: 'frontend-challenge' },
  { owner: 'thiagoborba', repo: 'chartOfAccounts' },
];

const REPO_TECHNOLOGIES: Record<string, string[]> = {
  'portifolio-front': ['nextjs', 'typescript', 'react', 'scss'],
  'portifolio-back': ['nodejs', 'typescript'],
  'briefing2task-front': ['nextjs', 'typescript', 'react'],
  'design-system': ['react', 'typescript', 'scss'],
  'frontend-challenge': ['react', 'typescript'],
  chartOfAccounts: ['typescript', 'nodejs'],
};

const INTERESTING_EXTENSIONS = ['.tsx', '.ts'];

const CONFIG_FILES = new Set([
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'tailwind.config.ts',
  'tailwind.config.js',
  'postcss.config.js',
  'jest.config.ts',
  'jest.config.js',
  'eslint.config.mjs',
  '.eslintrc.js',
  'vite.config.ts',
]);

const MIN_FUNCTION_LINES = 5;
const MAX_FUNCTION_LINES = 50;

function extractFunctions(code: string): string[] {
  const lines = code.split('\n');
  const functions: string[] = [];

  const FUNCTION_START =
    /^(export\s+)?(default\s+)?(async\s+)?function\s+\w*|^(export\s+)?const\s+\w+[^=]+=\s*(async\s*)?\(/;

  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const currentLine = lines[lineIndex].trimStart();

    if (!FUNCTION_START.test(currentLine)) {
      lineIndex++;
      continue;
    }

    const functionStartLine = lineIndex;
    let openBraces = 0;
    let openParens = 0;
    let bodyStarted = false;
    let foundEnd = false;

    for (let j = lineIndex; j < lines.length; j++) {
      for (const char of lines[j]) {
        if (char === '{') {
          openBraces++;
          bodyStarted = true;
        } else if (char === '}') {
          openBraces--;
        } else if (char === '(') {
          openParens++;
          bodyStarted = true;
        } else if (char === ')') {
          openParens--;
        }
      }

      const functionClosed =
        bodyStarted && openBraces === 0 && openParens === 0;
      if (functionClosed) {
        const functionBlock = lines.slice(functionStartLine, j + 1);
        const isWithinSizeRange =
          functionBlock.length >= MIN_FUNCTION_LINES &&
          functionBlock.length <= MAX_FUNCTION_LINES;

        if (isWithinSizeRange) {
          functions.push(functionBlock.join('\n'));
        }

        lineIndex = j + 1;
        foundEnd = true;
        break;
      }
    }

    if (!foundEnd) lineIndex++;
  }

  return functions;
}

async function fetchSnippetForRepo(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<Snippet | null> {
  try {
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: 'HEAD',
      recursive: '1',
    });

    const candidateFiles = tree.tree
      .filter(
        (file) =>
          file.type === 'blob' &&
          INTERESTING_EXTENSIONS.some((ext) => file.path?.endsWith(ext)) &&
          !CONFIG_FILES.has(file.path?.split('/').pop() ?? ''),
      )
      .map((file) => file.path!)
      .sort((a, b) => {
        const score = (path: string) =>
          (path.includes('src/') ? 1 : 0) +
          (path.split('/').length > 2 ? 1 : 0);
        return score(b) - score(a);
      });

    for (const filePath of candidateFiles.slice(0, 5)) {
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath,
      });

      if (Array.isArray(fileData) || fileData.type !== 'file') continue;

      const fileContent = Buffer.from(fileData.content, 'base64').toString(
        'utf-8',
      );
      const functions = extractFunctions(fileContent);

      if (functions.length === 0) continue;

      const filename = filePath.split('/').pop()!;
      const rawHtml = await codeToHtml(functions[0], {
        lang: 'typescript',
        theme: 'github-dark',
      });
      const html = sanitizeShikiHtml(rawHtml);

      return { repo: `${owner}/${repo}`, filename, html };
    }

    return null;
  } catch (err) {
    console.warn(`[github.ts] Ignorando ${owner}/${repo}:`, err);
    return null;
  }
}

export async function fetchSnippets(): Promise<Snippet[]> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const results = await Promise.allSettled(
    REPOS.map(({ owner, repo }) => fetchSnippetForRepo(octokit, owner, repo)),
  );

  return results
    .filter(
      (result): result is PromiseFulfilledResult<Snippet> =>
        result.status === 'fulfilled' && result.value !== null,
    )
    .map((result) => result.value);
}

function formatRepoName(name: string): string {
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function fetchProjects(): Promise<Project[]> {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const { data: repos } = await octokit.repos.listForUser({
    username: 'thiagoborba',
    sort: 'updated',
    per_page: 100,
  });

  return repos.map((repo) => {
    const fromTopics = [...(repo.topics ?? [])];
    const fromLanguage =
      repo.language && !fromTopics.includes(repo.language.toLowerCase())
        ? [repo.language.toLowerCase()]
        : [];
    const fromConfig = REPO_TECHNOLOGIES[repo.name] ?? [];

    const technologies = [
      ...new Set([...fromTopics, ...fromLanguage, ...fromConfig]),
    ];
    return {
      id: String(repo.id),
      name: repo.name,
      description: repo.description ?? formatRepoName(repo.name),
      githubUrl: repo.html_url,
      technologies,
      language: repo.language ?? null,
      stars: repo.stargazers_count ?? 0,
      updatedAt: repo.updated_at ?? '',
      homepage: repo.homepage ?? null,
    };
  });
}
