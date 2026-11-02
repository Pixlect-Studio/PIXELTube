export async function getActiveAds() {
    try {
        const res = await fetch('/api/ads');
        const data = await res.json();
        return data.ads || [];
    } catch (e) { return []; }
}

export function createAdCard(ad) {
    return `
        <article class="card ad-card" onclick="window.open('${ad.targetUrl}', '_blank')">
            <div class="thumb" style="background:#222; border: 2px solid #ffcc00;">
                <img src="${ad.imageUrl}" alt="Ad" onerror="this.src='https://placehold.co/600x338/222/ffcc00?text=Sponsored'">
                <span class="duration" style="background:#ffcc00; color:#000; font-weight:800; font-size:10px;">SPONSORED</span>
            </div>
            <div class="card-body">
                <div class="avatar" style="background:#ffcc00; color:#000;">A</div>
                <div class="card-meta">
                    <h3 class="card-title" style="color:#ffcc00;">${ad.title}</h3>
                    <div class="card-channel">Sponsored Link</div>
                    <div class="card-stats">Click to visit</div>
                </div>
            </div>
        </article>
    `;
}