const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// =========================================================================
// 🔴 COLOQUE AQUI O LINK DO SEU FIREBASE REALTIME DATABASE (DA TAREFA 1)
// =========================================================================
const FIREBASE_URL = (process.env.FIREBASE_URL || "https://cronoracing-resultados-default-rtdb.firebaseio.com").replace(/\/$/, "");

app.use(cors()); // Libera CORS geral (nunca dá erro 403)
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 1. ROTA DE HEALTH CHECK (Para o CronoRacing monitorar e acordar o servidor)
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 2. ROTA QUE RECEBE OS RESULTADOS DO CRONORACING (Completo ou Incremental)
app.post('/api/results', async (req, res) => {
    try {
        const payload = req.body;
        if (!payload || !Array.isArray(payload.results)) {
            return res.status(400).json({ error: 'Formato de JSON inválido. Esperado array results.' });
        }

        const slug = String(payload.event_slug || 'corrida').trim().toLowerCase().replace(/\s+/g, '-');
        const titulo = payload.event_title || 'Resultados Oficiais';

        // Converte o array de atletas em um dicionário indexado pelo bib_number.
        // Vantagem: Se o CronoRacing mandar 1 atleta (Incremental) ou 500 (Completo),
        // o Firebase atualiza apenas quem veio no pacote sem apagar o restante e sem abrir 500 conexões!
        const mapaAtletas = {};
        payload.results.forEach(atleta => {
            const bib = String(atleta.bib_number || '').trim();
            if (bib) {
                mapaAtletas[bib] = atleta;
            }
        });

        // Atualiza os metadados do evento no Firebase
        await fetch(`${FIREBASE_URL}/eventos/${slug}.json`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_title: titulo,
                event_slug: slug,
                updated_at: new Date().toISOString()
            })
        });

        // Salva/Atualiza os atletas em uma única requisição ultra-rápida no Firebase
        if (Object.keys(mapaAtletas).length > 0) {
            const fbRes = await fetch(`${FIREBASE_URL}/eventos/${slug}/results.json`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mapaAtletas)
            });

            if (!fbRes.ok) {
                throw new Error(`Erro ao gravar no Firebase: Status ${fbRes.status}`);
            }
        }

        return res.status(200).json({
            accepted: true,
            event_slug: slug,
            imported_count: payload.results.length
        });
    } catch (error) {
        console.error('[ERRO POST /api/results]:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// 3. ROTA QUE RESETA OS RESULTADOS (Chamada pelo botão Resetar Site do CronoRacing)
app.post('/api/results/reset', async (_req, res) => {
    try {
        await fetch(`${FIREBASE_URL}/eventos.json`, { method: 'DELETE' });
        return res.status(200).json({ deleted_results: 'all', status: 'reset_ok' });
    } catch (error) {
        console.error('[ERRO RESET]:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

// 4. ROTA QUE ENTREGA OS RESULTADOS PARA A TELA DO SITE (Frontend)
app.get('/api/results', async (req, res) => {
    try {
        const fbRes = await fetch(`${FIREBASE_URL}/eventos.json`);
        const data = await fbRes.json();

        if (!data) {
            return res.json({ event: null, results: [] });
        }

        const slugQuery = req.query.event_slug;
        let evObj = null;

        if (slugQuery && data[slugQuery]) {
            evObj = data[slugQuery];
        } else {
            // Pega o último evento atualizado
            const listaEventos = Object.values(data);
            listaEventos.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
            evObj = listaEventos[0];
        }

        if (!evObj) return res.json({ event: null, results: [] });

        const listaAtletas = evObj.results ? Object.values(evObj.results) : [];

        return res.json({
            event: {
                event_title: evObj.event_title,
                event_slug: evObj.event_slug,
                updated_at: evObj.updated_at,
                total_results: listaAtletas.length
            },
            results: listaAtletas
        });
    } catch (error) {
        console.error('[ERRO GET /api/results]:', error.message);
        return res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 API e Site CronoRacing rodando na porta ${PORT}`);
});