import { Router, Request, Response } from 'express';
import { Resend } from 'resend';

const router = Router();
const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

interface ContactBody {
  name: string;
  email: string;
  message: string;
}

router.post('', async (req: Request<{}, {}, ContactBody>, res: Response) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido.' });
  }

  const name = req.body?.name;
  const email = req.body?.email;
  const message = req.body?.message;

  if (!name || !email || !message) {
    res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    return;
  }

  try {
    await resend.emails.send({
      from: 'Formulário de Contato <onboarding@resend.dev>',
      to: process.env.EMAIL_TO!,
      subject: `Novo contato de ${escapeHtml(name)}`,
      html: `
        <h2>Novo contato recebido</h2>
        <p><strong>Nome:</strong> ${escapeHtml(name)}</p>
        <p><strong>E-mail:</strong> ${escapeHtml(email)}</p>
        <p><strong>Mensagem:</strong></p>
        <p>${escapeHtml(message)}</p>
      `,
    });

    res
      .status(200)
      .json({ success: true, message: 'E-mail enviado com sucesso!' });
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    res.status(500).json({ error: 'Falha ao enviar o e-mail.' });
  }
});

export default router;
