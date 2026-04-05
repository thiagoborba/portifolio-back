import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import contactRouter from './routes/contact';
import githubRouter from './routes/github';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/contact-form', contactRouter);
app.use('/github', githubRouter);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
