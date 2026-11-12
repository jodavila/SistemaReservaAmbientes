
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");

const app = express();

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

const PORT = process.env.PORT || 8080;

const CALENDAR_ID = process.env.CALENDAR_ID;

const TIME_ZONE = "America/Sao_Paulo";

// Autenticação pela identidade de serviço do Google Cloud Run
const auth = new google.auth.GoogleAuth({
    scopes: [
        "https://www.googleapis.com/auth/calendar"
    ]
});

const calendar = google.calendar({
    version: "v3",
    auth
});

function criarData(date, time) {
    // Horário local de Brasília
    return new Date(`${date}T${time}:00-03:00`);
}

function validarSolicitacao(data) {
    const campos = [
        "department",
        "name",
        "date",
        "timei",
        "timef"
    ];

    for (const campo of campos) {
        if (!data[campo] || typeof data[campo] !== "string") {
            throw new Error(`Campo obrigatório: ${campo}`);
        }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) ||
        !/^\d{2}:\d{2}$/.test(data.timei) ||
        !/^\d{2}:\d{2}$/.test(data.timef)) {
        throw new Error("Data ou horário inválido.");
    }

    const inicio = criarData(data.date, data.timei);
    const fim = criarData(data.date, data.timef);

    if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
        throw new Error("Data ou horário inválido.");
    }

    if (fim <= inicio) {
        throw new Error("O horário final deve ser posterior ao inicial.");
    }

    if (inicio <= new Date()) {
        throw new Error("Não é possível reservar um horário passado.");
    }

    return { inicio, fim };
}

// Procura eventos que tenham qualquer sobreposição com o período solicitado
async function verificarDisponibilidade(inicio, fim) {
    let pageToken;

    do {
        const resposta = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: inicio.toISOString(),
            timeMax: fim.toISOString(),
            singleEvents: true,
            showDeleted: false,
            maxResults: 2500,
            pageToken
        });

        const eventos = resposta.data.items || [];

        const conflitos = eventos.filter(evento => {
            if (evento.status === "cancelled") return false;

            const inicioEvento = evento.start.dateTime
                ? new Date(evento.start.dateTime)
                : criarData(evento.start.date, "00:00");

            const fimEvento = evento.end.dateTime
                ? new Date(evento.end.dateTime)
                : criarData(evento.end.date, "00:00");

            // Intervalos se sobrepõem?
            return inicioEvento < fim && fimEvento > inicio;
        });

        if (conflitos.length > 0) {
            return true;
        }

        pageToken = resposta.data.nextPageToken;

    } while (pageToken);

    return false;
}

// Endpoint de saúde
app.get("/health", (req, res) => {
    res.json({ status: "online" });
});

// Endpoint para reservas
app.post("/reservas", async (req, res) => {
    try {
        const dados = req.body;

        const { inicio, fim } = validarSolicitacao(dados);

        // Verifica disponibilidade antes de criar
        const ocupado = await verificarDisponibilidade(inicio, fim);

        if (ocupado) {
            return res.status(409).json({
                success: false,
                message: "Este horário já possui um agendamento. Escolha outro horário."
            });
        }

        const evento = {
            summary: `${dados.department} - ${dados.name}`,
            description: [
                `Departamento: ${dados.department}`,
                `Evento: ${dados.name}`,
                `Descrição: ${dados.event || "Não informada"}`,
                `Dúvida: ${dados.duvida || "Nenhuma"}`
            ].join("\n"),

            location: "Sala dos Jovens - Igreja do Iguatemi",

            start: {
                dateTime: inicio.toISOString(),
                timeZone: TIME_ZONE
            },

            end: {
                dateTime: fim.toISOString(),
                timeZone: TIME_ZONE
            }
        };

        const resultado = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: evento
        });

        return res.status(201).json({
            success: true,
            message: "Reserva realizada com sucesso!",
            eventId: resultado.data.id,
            eventLink: resultado.data.htmlLink
        });

    } catch (erro) {
        console.error("Erro na reserva:", erro);

        return res.status(400).json({
            success: false,
            message: erro.message || "Não foi possível realizar a reserva."
        });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado na porta ${PORT}`);
});
