// themes/code.js
export function apply() {
    let style = document.getElementById('dynamic-theme');
    if (!style) {
        style = document.createElement('style');
        style.id = 'dynamic-theme';
        document.head.appendChild(style);
    }
    style.innerHTML = `
        :root {
            --bg: #1e1e1e; --bg-elev: #252526; --text: #d4d4d4; --text-dim: #858585;
            --border: #333333; --hover: #2a2d2e; --chip-bg: #2d2d2d; --accent: #569cd6;
        }
        * { font-family: 'Consolas', 'Courier New', monospace !important; border-radius: 0 !important; }
        body { background: var(--bg); color: var(--text); }
        
        .topbar { border-bottom: 1px solid var(--border); background: #007acc; color: white; }
        .logo-text { color: white; }
        .search-form { background: #3c3c3c; border: 1px solid #555; }
        .search-form input { color: #fff; }
        
        .sidebar { background: #252526; border-right: 1px solid #333; }
        .nav-item { border-bottom: 1px solid #333; padding: 12px; }
        .nav-item::before { content: '> '; color: #4ec9b0; }
        .nav-item:hover { background: #2a2d2e; }
        .nav-item svg { display: none; }
        
        .section-title::before { content: '// '; color: #6a9955; }
        
        .chip { background: #2d2d2d; border: 1px solid #555; color: #ce9178; }
        .chip.active { background: #37373d; border-color: #007acc; color: #4fc1ff; }
        
        .card { border: 1px solid #333; background: #1e1e1e; }
        .card:hover { border-color: #569cd6; }
        .thumb { border: 1px solid #444; }
        .card-title { color: #dcdcaa; }
        .card-title::before { content: 'const '; color: #569cd6; }
        
        .btn, .btn.primary, #pixlect-login { 
            background: #0e639c; color: #fff; border: none; padding: 8px 16px; 
        }
        .btn:hover, .btn.primary:hover, #pixlect-login:hover { background: #1177bb; }
    `;
}