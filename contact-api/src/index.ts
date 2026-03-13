import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import contactRouter from './routes/contact';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/contact-form', contactRouter);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
