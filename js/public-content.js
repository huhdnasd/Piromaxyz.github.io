import { loadSiteData } from "./site-data.js";

function renderSettings(settings) {
    const memberCount = document.querySelector("#member-count");
    if (memberCount) memberCount.textContent = `${settings.memberCount}+`;

    const communityRating = document.querySelector("#community-rating");
    if (communityRating) communityRating.textContent = `${Number(settings.communityRating).toFixed(1)}/5`;

    for (const plan of ["free", "premium", "ultimate"]) {
        document.querySelectorAll(`[data-price="${plan}"]`).forEach((element) => {
            element.textContent = settings.pricing[plan];
        });
    }

    for (const [service, status] of Object.entries(settings.status)) {
        const statusText = document.querySelector(`#${service}-status`);
        const statusCard = statusText?.closest(".status-card");
        if (!statusText || !statusCard) continue;

        const normalizedStatus = ["Online", "Degraded", "Offline", "Maintenance"]
            .find((value) => value.toLowerCase() === String(status).toLowerCase()) ?? "Offline";
        statusText.textContent = normalizedStatus;
        statusCard.classList.remove("online", "degraded", "offline", "maintenance");
        statusCard.classList.add(normalizedStatus.toLowerCase());
    }

    const incident = document.querySelector("#incident-description");
    if (incident) incident.textContent = settings.incident;

    const reviewSection = document.querySelector("#community-reviews");
    const reviewList = document.querySelector("#review-list");
    if (reviewSection && reviewList) {
        reviewList.replaceChildren();
        for (const review of settings.reviews) {
            const article = document.createElement("article");
            article.className = "review-card";

            const rating = document.createElement("p");
            rating.className = "review-rating";
            rating.textContent = `${Number(review.rating)} / 5`;

            const quote = document.createElement("blockquote");
            quote.textContent = review.text;

            const author = document.createElement("strong");
            author.textContent = review.name;

            article.append(rating, quote, author);
            reviewList.append(article);
        }
        reviewSection.hidden = settings.reviews.length === 0;
    }
}

renderSettings(await loadSiteData());

if ("BroadcastChannel" in window) {
    const settingsChannel = new BroadcastChannel("piroma-site-settings");
    settingsChannel.addEventListener("message", (event) => {
        if (event.data?.type === "published" && event.data.settings) {
            renderSettings(event.data.settings);
        }
    });
}