import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import baileys from '@whiskeysockets/baileys';
const makeWASocket = baileys.default || baileys;
const { useMultiFileAuthState, DisconnectReason } = baileys;
const { useMultiFileAuthState, DisconnectReason } = baileys;
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import cron from 'node-cron';
import qrcode from 'qrcode-terminal';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors());

let sock;
const ARCHIVO_CITAS = path.join(__dirname, 'citas.json');

// Función para leer las citas del archivo local si ya existe
function cargarCitasDisco() {
    try {
        if (fs.existsSync(ARCHIVO_CITAS)) {
            const data = fs.readFileSync(ARCHIVO_CITAS, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error al leer el archivo de citas:', error);
    }
    return [];
}

// Función para guardar las citas en el archivo local automáticamente
function guardarCitasDisco(citasArray) {
    try {
        fs.writeFileSync(ARCHIVO_CITAS, JSON.stringify(citasArray, null, 2), 'utf8');
    } catch (error) {
        console.error('Error al guardar en el archivo de citas:', error);
    }
}

// Cargamos las citas al arrancar el servidor
let citas = cargarCitasDisco();

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    sock = makeWASocket({
        auth: state
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                // Añadido respiro de 3 segundos para evitar bucles de reconexión rápida
                setTimeout(() => {
                    connectToWhatsApp();
                }, 3000);
            }
        } else if (connection === 'open') {
            console.log('\n¡Conectado a WhatsApp correctamente!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

// Endpoint para guardar una cita nueva (ahora también la guarda en el archivo)
app.post('/api/cita', (req, res) => {
    const { nombre, telefono, fechaHora, servicio, duracion, precio, notas } = req.body;
    
    if (!telefono || !fechaHora || !nombre) {
        return res.status(400).json({ error: 'El nombre, teléfono y la fecha son obligatorios' });
    }

    const nuevaCita = {
        id: Date.now(),
        nombre,
        telefono,
        fechaHora,
        servicio,
        duracion: duracion || '60 min',
        precio: precio || '',
        notas: notas || '',
        recordatorioEnviado: false
    };

    citas.push(nuevaCita);
    guardarCitasDisco(citas); // Guardamos en el archivo citas.json

    console.log(`Cita guardada y guardada en disco para: ${nombre} (${telefono})`);
    res.status(200).json({ status: 'success', message: 'Cita registrada con éxito' });
});

// Endpoint para consultar el historial desde la web
app.get('/api/citas', (req, res) => {
    const citasOrdenadas = [...citas].sort((a, b) => new Date(b.fechaHora) - new Date(a.fechaHora));
    res.status(200).json(citasOrdenadas);
});

// NUEVO: Endpoint para borrar una cita cuando le das al botón de eliminar
app.delete('/api/cita/:id', (req, res) => {
    const idCita = Number(req.params.id);
    const longitudAntes = citas.length;
    
    citas = citas.filter(cita => cita.id !== idCita);

    if (citas.length < longitudAntes) {
        guardarCitasDisco(citas); // Actualizamos el archivo borrando la cita
        console.log(`Cita con ID ${idCita} eliminada.`);
        res.status(200).json({ status: 'success', message: 'Cita eliminada' });
    } else {
        res.status(404).json({ error: 'Cita no encontrada' });
    }
});

// Cron job de WhatsApp cada minuto
cron.schedule('* * * * *', async () => {
    if (!sock) return;

    const ahora = new Date();
    let cambiosRealizados = false;

    for (let cita of citas) {
        if (cita.recordatorioEnviado) continue;

        const diferenciaMilisegundos = new Date(cita.fechaHora).getTime() - ahora.getTime();
        const minutosRestantes = diferenciaMilisegundos / (1000 * 60);

        if (minutosRestantes > 0 && minutosRestantes <= 1440) {
            const numeroJid = `${cita.telefono}@s.whatsapp.net`;
            const mensaje = `Hola ${cita.nombre}, te escribimos del centro de quiromasaje para recordarte tu cita de "${cita.servicio}" (${cita.duracion}) programada para el ${new Date(cita.fechaHora).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'})}. ¡Te esperamos!`;

            try {
                await sock.sendMessage(numeroJid, { text: mensaje });
                console.log(`Recordatorio enviado con éxito a ${cita.nombre} (${cita.telefono})`);
                cita.recordatorioEnviado = true;
                cambiosRealizados = true;
            } catch (error) {
                console.error(`Error al enviar mensaje a ${cita.telefono}:`, error);
            }
        }
    }

    if (cambiosRealizados) {
        guardarCitasDisco(citas); // Guardamos si cambia el estado del recordatorio a "enviado"
    }
});

// Para que Express sirva el archivo HTML automáticamente
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const server = app.listen(3000, () => {
    console.log('Servidor corriendo en el puerto 3000 (con persistencia local)');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log('El puerto ya estaba en uso, pero continuamos sin problema.');
    }
});
