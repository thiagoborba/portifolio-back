import { Router, Request, Response } from 'express';
import { fetchSnippets, fetchProjects, Snippet, Project } from '../lib/github.js';

const router = Router();

const CACHE_TTL = 60 * 60 * 1000;

let snippetsCache: { data: Snippet[]; ts: number } | null = null;
let projectsCache: { data: Project[]; ts: number } | null = null;

function isFresh(ts: number): boolean {
  return Date.now() - ts < CACHE_TTL;
}

router.get('/snippets', async (_req: Request, res: Response) => {
  try {
    if (snippetsCache && isFresh(snippetsCache.ts)) {
      return res.json(snippetsCache.data);
    }
    const data = await fetchSnippets();
    snippetsCache = { data, ts: Date.now() };
    res.json(data);
  } catch (err) {
    console.error('[/github/snippets]', err);
    res.status(500).json({ error: 'Falha ao buscar snippets.' });
  }
});

router.get('/projects', async (_req: Request, res: Response) => {
  try {
    if (projectsCache && isFresh(projectsCache.ts)) {
      return res.json(projectsCache.data);
    }
    const data = await fetchProjects();
    projectsCache = { data, ts: Date.now() };
    res.json(data);
  } catch (err) {
    console.error('[/github/projects]', err);
    res.status(500).json({ error: 'Falha ao buscar projetos.' });
  }
});

export default router;
