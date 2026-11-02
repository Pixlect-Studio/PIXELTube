export function getCSS() {
    return `
        :root {
            --bg: #ffffff; --bg-elev: #f9f9f9; --text: #0f0f0f; --text-dim: #606060;
            --border: #e0e0e0; --hover: #f0f0f0; --chip-bg: #eeeeee; --accent: #065fd4;
        }
        body { background: var(--bg); color: var(--text); font-family: Roboto, sans-serif; }
        .card { transition: transform 0.2s; }
        .card:hover { transform: translateY(-4px); }
        .thumb { border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        .sidebar { border-right: 1px solid var(--border); }
        .btn.primary { background: var(--accent); color: white; }
        .avatar { background: #ccc !important; color: #333 !important; }
        .thumb img { object-fit: cover; }
    `;
}