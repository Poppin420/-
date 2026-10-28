# Ανέβασμα (deploy) εκτός Netlify

Η εφαρμογή τρέχει σε **οποιονδήποτε** πάροχο που δίνει Node + PostgreSQL, μέσω του
φορητού server (`npm start` → `server.mjs`). Παρακάτω ο δωρεάν δρόμος: **Render + Neon**.

## 1. Βάση δεδομένων — Neon (δωρεάν)

1. Μπες στο https://neon.tech και φτιάξε δωρεάν project (περιοχή ΕΕ, π.χ. Frankfurt).
2. Αντίγραψε το **connection string** (προτίμησε το **Pooled**). Μοιάζει με:
   `postgresql://user:password@...neon.tech/dbname?sslmode=require`
3. Κράτα το — θα το βάλεις στο Render ως `DATABASE_URL`. **Μην το γράψεις πουθενά δημόσια.**

Το `btree_gist` που χρειάζεται το migration υποστηρίζεται από το Neon. Τα migrations
τρέχουν **μόνα τους** στο ξεκίνημα του server.

## 2. Φιλοξενία — Render (δωρεάν)

1. https://render.com → σύνδεση με GitHub.
2. **New → Blueprint** και διάλεξε αυτό το repo (διαβάζει το `render.yaml`), ή **New → Web Service** με:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
3. Στο **Environment** βάλε τα μυστικά (δες πίνακα).
4. Deploy. Το `APP_BASE_URL` συμπληρώνεται αυτόματα από το Render.

## 3. Μεταβλητές περιβάλλοντος

| Μεταβλητή | Υποχρεωτική | Τι είναι |
|---|---|---|
| `DATABASE_URL` | Ναι | Το Neon connection string. |
| `DATA_ENCRYPTION_KEY` | Για ΑΑΔΕ/Google | 32 bytes base64: `openssl rand -base64 32`. Κρυπτογραφεί τα κλειδιά myDATA & Google. **Αν χαθεί, ξαναβάζονται τα κλειδιά.** |
| `SIGNUP_CODE` | Για εγγραφές | Κωδικός πρόσκλησης (≥ 8 χαρακτήρες). Κενό = κλειστές εγγραφές. |
| `GROQ_API_KEY` | Για φωνή | Από https://console.groq.com. |
| `GROQ_LLM_MODEL` | Όχι | Προεπιλογή εδώ: `qwen/qwen3.8-27b` (δουλεύει στον δωρεάν λογαριασμό· το `llama-3.3-70b-versatile` θέλει πληρωμένο). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Όχι | Για συγχρονισμό Google Calendar. |

## Σημειώσεις

- **Δωρεάν tier:** η υπηρεσία «κοιμάται» μετά από αδράνεια· το πρώτο αίτημα μπορεί να αργήσει ~1′.
- **Rate limiting:** το όριο αιτημάτων που είχε το Netlify δεν υπάρχει στον Node server. Για παραγωγή, βάλε
  όριο στον πάροχο ή πρόσθεσέ το (TODO).
- **Άλλος πάροχος / δικός σου server:** ίδιο `server.mjs` — απλώς δώσε `PORT`, `DATABASE_URL` και τα υπόλοιπα.
