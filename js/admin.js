import {
    isSupabaseConfigured,
    loadSiteData,
    supabase
} from "./site-data.js";

const loginForm = document.querySelector("#admin-login");
const editor = document.querySelector("#admin-editor");
const message = document.querySelector("#admin-message");
const reviewList = document.querySelector("#admin-reviews");
const statusOptions = ["Online", "Degraded", "Offline", "Maintenance"];
const adminEmail = "tal.lewis30@gmail.com";

for (const select of document.querySelectorAll(".admin-fields select")) {
    for (const status of statusOptions) {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        select.append(option);
    }
}

function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error-message", isError);
}

function addReview(review = { name: "", rating: 5, text: "" }) {
    const row = document.createElement("fieldset");
    row.className = "admin-review-row";

    const nameLabel = document.createElement("label");
    nameLabel.textContent = "Reviewer";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 80;
    nameInput.value = review.name ?? "";
    nameLabel.append(nameInput);

    const ratingLabel = document.createElement("label");
    ratingLabel.textContent = "Rating (1-5)";
    const ratingInput = document.createElement("input");
    ratingInput.type = "number";
    ratingInput.min = "1";
    ratingInput.max = "5";
    ratingInput.step = "1";
    ratingInput.value = review.rating ?? 5;
    ratingLabel.append(ratingInput);

    const textLabel = document.createElement("label");
    textLabel.className = "review-text-field";
    textLabel.textContent = "Review";
    const textInput = document.createElement("textarea");
    textInput.rows = 3;
    textInput.maxLength = 500;
    textInput.value = review.text ?? "";
    textLabel.append(textInput);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn secondary remove-review";
    removeButton.textContent = "Remove review";
    removeButton.addEventListener("click", () => row.remove());

    row.append(nameLabel, ratingLabel, textLabel, removeButton);
    reviewList.append(row);
}

function fillEditor(settings) {
    document.querySelector("#member-count").value = settings.memberCount;
    document.querySelector("#community-rating").value = settings.communityRating;
    for (const plan of ["free", "premium", "ultimate"]) {
        document.querySelector(`#price-${plan}`).value = settings.pricing[plan];
    }
    for (const service of ["bot", "api", "database", "discord"]) {
        document.querySelector(`#status-${service}`).value = settings.status[service];
    }
    document.querySelector("#incident-description").value = settings.incident;
    reviewList.replaceChildren();
    settings.reviews.forEach(addReview);
}

function collectReviews() {
    return [...reviewList.querySelectorAll(".admin-review-row")].map((row) => ({
        name: row.querySelector("input[type=text]").value.trim(),
        rating: Number(row.querySelector("input[type=number]").value),
        text: row.querySelector("textarea").value.trim()
    }));
}

function collectSettings() {
    const reviews = collectReviews();
    if (reviews.some((review) => !review.name || !review.text || review.rating < 1 || review.rating > 5)) {
        throw new Error("Each review needs a name, a rating from 1 to 5, and review text.");
    }

    const status = {};
    for (const service of ["bot", "api", "database", "discord"]) {
        status[service] = document.querySelector(`#status-${service}`).value;
    }

    return {
        memberCount: Number(document.querySelector("#member-count").value),
        communityRating: Number(document.querySelector("#community-rating").value),
        pricing: {
            free: Number(document.querySelector("#price-free").value),
            premium: Number(document.querySelector("#price-premium").value),
            ultimate: Number(document.querySelector("#price-ultimate").value)
        },
        status,
        incident: document.querySelector("#incident-description").value.trim(),
        reviews
    };
}

async function showEditor(user) {
    const isAdmin = user?.app_metadata?.role === "admin" ||
        user?.email?.trim().toLowerCase() === adminEmail;
    if (!isAdmin) {
        await supabase.auth.signOut();
        loginForm.hidden = false;
        editor.hidden = true;
        setMessage("This account does not have admin access.", true);
        return;
    }

    try {
        const settings = await loadSiteData({ fallbackOnError: false });
        fillEditor(settings);
        loginForm.hidden = true;
        editor.hidden = false;
        setMessage("Signed in. Changes publish to the public site when saved.");
    } catch (error) {
        loginForm.hidden = false;
        editor.hidden = true;
        setMessage(`Could not load site settings: ${error.message}`, true);
    }
}

if (!isSupabaseConfigured) {
    loginForm.hidden = true;
    setMessage("Admin setup is incomplete. Add your Supabase project URL and anon key in js/site-data.js, then run the SQL setup in README.md.", true);
} else {
    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = loginForm.querySelector("button[type=submit]");
        button.disabled = true;
        setMessage("Signing in...");

        const { data, error } = await supabase.auth.signInWithPassword({
            email: document.querySelector("#admin-email").value,
            password: document.querySelector("#admin-password").value
        });

        button.disabled = false;
        if (error) {
            setMessage(error.message, true);
            return;
        }
        await showEditor(data.user);
    });

    supabase.auth.getSession().then(({ data }) => {
        if (data.session) showEditor(data.session.user);
    });

    document.querySelector("#add-review").addEventListener("click", () => addReview());
    document.querySelector("#admin-logout").addEventListener("click", async () => {
        await supabase.auth.signOut();
        editor.hidden = true;
        loginForm.hidden = false;
        setMessage("Signed out.");
    });

    editor.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!editor.reportValidity()) return;

        let settings;
        try {
            settings = collectSettings();
        } catch (error) {
            setMessage(error.message, true);
            return;
        }

        const saveButton = editor.querySelector("button[type=submit]");
        saveButton.disabled = true;
        setMessage("Saving changes...");
        try {
            const { data, error } = await supabase
                .from("site_settings")
                .update({ settings })
                .eq("id", "public")
                .select("id")
                .single();

            if (error) {
                setMessage(`Could not save: ${error.message}`, true);
                return;
            }
            if (!data) {
                setMessage("Could not save: no settings row was updated. Check the Supabase admin policy and setup.", true);
                return;
            }
            setMessage("Changes saved and published.");
        } catch (error) {
            setMessage(`Could not save: ${error.message}`, true);
        } finally {
            saveButton.disabled = false;
        }
    });
}