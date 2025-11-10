import express from "express";
import cors from "cors";
import axios from "axios";
import ytdlp from "yt-dlp-exec";
import NodeCache from "node-cache";
import YTMusic from "ytmusic-api";
import saavnapi from "saavnapi";

const app = express();
app.use(cors());
app.use(express.json());

const cache = new NodeCache({ stdTTL: 600 });
const yt = new YTMusic();

await yt.initialize();


// ✅ JioSaavn SEARCH
app.get("/jiosaavn/search", async (req, res) => {
    try {
        const query = req.query.q;
        const results = await saavnapi.search(query);

        res.json(results);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "JioSaavn search failed" });
    }
});


// ✅ JioSaavn SONG DETAILS
app.get("/jiosaavn/song", async (req, res) => {
    try {
        const id = req.query.id;
        const results = await saavnapi.song(id);

        res.json(results);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "JioSaavn track fetch failed" });
    }
});


// ✅ YouTube Music SEARCH
app.get("/youtube/search", async (req, res) => {
    try {
        const query = req.query.q;
        const results = await yt.search(query, "songs");

        res.json(results);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "YouTube Music search failed" });
    }
});


// ✅ YouTube -> Audio Stream URL
app.get("/youtube/audio", async (req, res) => {
    try {
        const id = req.query.id;

        const cached = cache.get(id);
        if (cached) return res.json({ url: cached });

        const out = await ytdlp(`https://www.youtube.com/watch?v=${id}`, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            addHeader: ["referer:youtube.com", "user-agent:googlebot"]
        });

        const audio = out.formats.find(f => f.acodec !== "none" && f.vcodec === "none");

        cache.set(id, audio.url);

        res.json({ url: audio.url });

    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "YouTube audio fetch failed" });
    }
});


// ✅ Combined Search (JioSaavn + YouTube)
app.get("/search", async (req, res) => {
    try {
        const q = req.query.q;

        const [saavn, ytMusic] = await Promise.all([
            saavnapi.search(q),
            yt.search(q, "songs")
        ]);

        res.json({
            jiosaavn: saavn,
            youtube: ytMusic
        });

    } catch (err) {
        res.status(500).json({ error: "Combined search failed" });
    }
});


// ✅ Root
app.get("/", (req, res) => {
    res.send("✅ Music API Backend Running...");
});


// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
