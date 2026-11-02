export function getCSS() {
    return `
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;700&display=swap');
        :root {
            --bg: #05050a; --bg-elev: #0f0f18; --text: #e0e0ff; --text-dim: #7a7a9a;
            --border: #ff00ff; --hover: #ff00ff22; --chip-bg: #1a1a2e; --accent: #00ffcc;
        }
        body { 
            background: var(--bg); color: var(--text); font-family: 'Rajdhani', sans-serif; 
            background-image: radial-gradient(circle at 50% 0%, #1a0033 0%, #05050a 70%);
        }
        .topbar { border-bottom: 2px solid #00ffcc; box-shadow: 0 0 15px #00ffcc44; }
        .logo-text { color: #ff00ff; text-shadow: 0 0 10px #ff00ff; letter-spacing: 2px; text-transform: uppercase; }
        .sidebar { border-right: 1px solid #ff00ff55; }
        .nav-item { border-left: 3px solid transparent; transition: all 0.2s; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; }
        .nav-item:hover { border-left: 3px solid #00ffcc; background: #ff00ff22; transform: translateX(5px); text-shadow: 0 0 8px #00ffcc; }
        .chip { border: 1px solid #ff00ff; text-transform: uppercase; }
        .chip.active { background: #ff00ff; color: #000; box-shadow: 0 0 10px #ff00ff; }
        .card { border: 1px solid #ff00ff55; border-radius: 4px; transform: perspective(800px) rotateY(2deg); transition: all 0.3s ease; overflow: hidden; }
        .card:hover { transform: perspective(800px) rotateY(0deg) scale(1.02); box-shadow: 0 0 20px #00ffcc88; border-color: #00ffcc; }
        .thumb { border-radius: 0; }
        .thumb img { filter: contrast(1.2) saturate(1.5); }
        .btn.primary, #pixlect-login { background: transparent; border: 1px solid #00ffcc; color: #00ffcc; text-transform: uppercase; box-shadow: inset 0 0 10px #00ffcc44; }
        .btn.primary:hover { background: #00ffcc; color: #000; box-shadow: 0 0 15px #00ffcc; }
    `;
}