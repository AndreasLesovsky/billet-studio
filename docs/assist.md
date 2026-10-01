# Billet assistant — the questionnaire contract

"Describe your billet in one sentence": a chat on the home page and in the template gallery. A
person writes what they want ("a birthday card for my brother, more elegant than colourful, with a
champagne bottle instead of a cake, in dark mode and in English"), the app answers with an offer -
a picture of the look, what it starts with and "Billet anlegen" - and every follow-up ("rather
light", "without confetti") changes the offer.

**The model writes no text and no UI.** A local model (Ollama, `qwen2.5:14b`) only answers a typed
questionnaire: seven choice questions with fixed labels. The backend merges the labels into a
start configuration; the frontend says everything in i18n and builds the billet with the start-link
code of `/billets/new`. Without the model the template gallery stays as it is.

The technique comes from the jev-demo by Manfred Steyer (TypeSafe's Jev "System One" and its local
stand-in, `server/src/local-jev/`), ported to Java: Spring talks to Ollama itself.

## Files

| What | Where |
|---|---|
| Questions, labels, descriptions (bilingual), template looks | `billet-studio-rest-service/src/main/resources/assist/billet-questionnaire.json` |
| Prompt layout and schema (port of `questionnaire.ts`) | `assist/questionnaire/Questionnaire.java` |
| Ollama client (port of `ollama.ts`) | `assist/ollama/OllamaQuestionnaireClient.java` |
| The seven questions, state, merge | `assist/service/BilletQuestionnaire.java` |
| Switch, single slot, status cache | `assist/service/AssistService.java` |
| Endpoints | `assist/controller/AssistController.java`, [api-contract.md](api-contract.md) |
| Labels → start link | `billet-studio-frontend/src/app/shared/components/billet-assistant/assist-start.ts`, `billet/billet-start.ts` |
| Chat | `shared/components/billet-assistant/`, `core/stores/assist-conversation-store.ts` |

## The questions

All seven are choice questions; their names are the JSON keys of the answer. `model` comes last:
it is the only list that changes (with the library, `tbl_models` active rows by `position`).

| Question | Labels |
|---|---|
| `template` | KEEP, valentinstag, geburtstag, weihnachten, hochzeit, muttertag, BLANK, NOT_SUPPORTED |
| `theme` | KEEP, TEMPLATE_DEFAULT, the 16 theme ids |
| `particles` | KEEP, TEMPLATE_DEFAULT, NONE, petal, snowflake, leaf, confetti, heart |
| `divider` | KEEP, TEMPLATE_DEFAULT, diamond, dot, heart, star, line, none |
| `colorMode` | KEEP, auto, light, dark |
| `lang` | KEEP, UI_LANGUAGE, de, en |
| `model` | KEEP, TEMPLATE_DEFAULT, NONE, the active slugs, NOT_SUPPORTED |

- **KEEP**: the new message asks for no change here. **TEMPLATE_DEFAULT**: what the template comes
  with; it stays symbolic, so it follows a template that changes later.
- **BLANK**: an occasion no template is made for (farewell, baptism, thank-you …) or a blank start.
  **template NOT_SUPPORTED**: the message is not about a greeting card at all.
- **NONE** switches the particles or the 3D scene off; divider `none` is a real style (no ornament).
- **model NOT_SUPPORTED**: an object is named that the library does not have. Particles have no
  such label: the measurement showed the model choosing it for messages about anything else.
- **lang**: a language named for the billet counts; otherwise only the first description counts, by
  the language it is written in; later messages change it only by naming one. UI_LANGUAGE when
  nothing tells. The question `lang` asks only for a *named* language. The language a message is
  *written* in is a second call with one question (`messageLanguage`: en, de, OTHER, the message
  alone as state), made only when nothing has been offered yet and `lang` came back KEEP. Inside
  the seven questions the model read English sentences as German; alone it does not.
- Every description is **English with the German words in parentheses**, in one prompt for
  everybody: the question block is the same bytes for every user and both languages, so the prompt
  cache is never split. Theme options describe moods, never hex values. Template options also spell
  out their default look (theme, model, particles, divider), so follow-ups about the current look
  can be judged.

## The state

The chat as compact JSON, built as a tree (no record serialisation: Jackson 3 would sort the keys
and write nulls), labels in question order:

```json
{"conversation":[{"role":"user","content":"Geburtstag, schick"},
 {"role":"assistant","billet":{"template":"geburtstag","theme":"midnight","particles":"TEMPLATE_DEFAULT",
  "divider":"TEMPLATE_DEFAULT","colorMode":"dark","lang":"en","model":"champagne-bottle"}},
 {"role":"user","content":"lieber hell"}]}
```

At most 10 entries (as the demo's `MAX_TURNS`), oldest first, the last one is the new message.
Messages the assistant could not answer and answers without a new billet are left out.

## The merge (backend)

The billet offered last (or the blank start: BLANK, TEMPLATE_DEFAULT …, auto, UI_LANGUAGE) plus
the answers: KEEP keeps a value, NOT_SUPPORTED keeps it and adds a note, every other label replaces
it. Notes for the frontend (`ASSIST.NOTES.<code>`):

| Note | When | Offer |
|---|---|---|
| `OFF_TOPIC` | template NOT_SUPPORTED | none, the billet stays |
| `NOTHING_RECOGNISED` | every answer KEEP on the first message | the blank start |
| `NO_CHANGE` | every answer KEEP later | none, the billet stays |
| `MODEL_NOT_SUPPORTED` | model NOT_SUPPORTED | yes, with the old model |

## Prompt rules (measured — change nothing without measuring again)

Ported 1:1 from `local-jev/questionnaire.ts` and `ollama.ts`, pinned by `QuestionnaireTest` and
`OllamaQuestionnaireClientTest`:

- The system text word for word, `reasoning` in backticks.
- User message `Questions:\n\n<blocks>\n\nState:\n<state>`: **the questions before the state**, so
  the unchanging prefix stays in Ollama's prompt cache.
- Choice block: `name: instructions`, one `Options:` line for undescribed labels, then
  `Option <label>: <description>`.
- JSON schema as `format`: **`reasoning` first** (string, `maxLength` 300), then one string `enum`
  per question under its real name, everything required.
- `temperature 0`, `num_ctx 12288`, `stream false`, `keep_alive` (`ASSIST_KEEP_ALIVE`, default 1h).
- Every answer first awaits the model load (single-flight, the same options, so Ollama does not
  load the model again with another context size). No retry on a wrong label: at temperature 0 the
  same prompt gives the same answer.
- The model is weak at exact numbers and orders: no question asks for one. A question about
  amounts (more confetti, a bigger model) would offer relative steps (`FEWER`, `KEEP`, `MORE`).

## Availability and the GPU

- `GET /v1/assist/status` asks Ollama read-only: `/api/ps` lists the model → READY, `/api/tags`
  has it → IDLE (the first answer waits for the load), else OFFLINE. Cached for 10 s.
- **The model is loaded when someone focuses the assistant's input** (`POST /v1/assist/warm-up`),
  never on a page visit; `ASSIST_WARM_UP=true` loads it at backend start instead. Ollama keeps it
  for `keep_alive` after the last answer.
- One answer at a time (`Semaphore(1)`): a question that finds no free slot within
  `ASSIST_TIMEOUT` gets 429. Run Ollama with `OLLAMA_NUM_PARALLEL=1`.
- Off (`ASSIST_ENABLED=false`, the default), a failed or unknown status: the frontend shows no
  assistant. OFFLINE: the box says so before anything is typed and does not send.

## Privacy

- The user's messages and the model's `reasoning` are never logged (the backend logs everything
  under `app.billetstudio` at DEBUG into a file) and never returned; only the labels leave the
  service.
- Ollama has no authentication: `ASSIST_URL` must be reachable from the backend only. In
  production the assistant stays off unless such a model server is part of the deployment.

## Setup (local)

```sh
ollama pull qwen2.5:14b
# .env.local of the backend
ASSIST_ENABLED=true
# optional: ASSIST_URL=http://127.0.0.1:11434, ASSIST_MODEL=qwen2.5:14b, ASSIST_KEEP_ALIVE=1h
```

`ollama ps` shows whether the model is in memory; it should appear only after the input got the
focus (or a question was sent).

## Adding a theme, a template or a model

- **Theme**: `themes.json` as usual, then its mood (English + German words) under `theme.criteria`.
- **Template**: its option under `template.criteria` and its look under `template.defaultLooks`.
- `AssistOptionsParityTest` reads the frontend's `themes.json`, `templates.ts`, `templates/*.ts` and
  `billet-document.ts` and fails until the questionnaire matches.
- **Model**: nothing to do - the active library rows are the labels, described by
  `nameEn (nameDe), occasion`.

## Measuring

Answer quality is measured against a real Ollama, outside the normal test run (A5):
`mvnw.cmd test -Dtest=AssistEval` with Ollama running. It prints the Ollama version, the model
digest, the accuracy per question and the latency, over German and English sentences, follow-ups
(KEEP), unsupported wishes and off-topic messages. For every miss it prints the model's labels and
its reasoning (a separate call; the eval is the only place that reads it).

### Result (1 October 2026)

Ollama 0.35.0, `qwen2.5:14b` (digest `7cdf5a01…`), RTX 5080, the model already loaded:
**22 of 22 turns entirely right** (11 conversations, every question of every turn), latency median
1.8 s, max 2.5 s per turn (the language call included).

What the measurement changed, in the order it was found:

| Miss | Cause | Fix |
|---|---|---|
| English sentences got `lang` de | one question for "named or written in" inside seven German-labelled ones | `lang` asks only for a named language; the written language is its own call (above) |
| "in Lila", "edel in Grau" kept the template's theme | the theme question read like a palette picker | its instructions list mood and style words (elegant, cosy, playful, in grey …) and KEEP says "no words about colours, mood, style or feel"; TEMPLATE_DEFAULT only when the person asks for the template's look again |
| "verspielt, bunt … Kindergeburtstag" chose the template by its colours | the template question competed with the theme | the template is chosen "by the occasion alone"; colours, mood, objects and particles are left to the other questions |
| A described card was called off-topic | NOT_SUPPORTED read as "something the app cannot do" | its description: a message about a card, its occasion or its look is always about a greeting card |
| Particles NOT_SUPPORTED for messages about colours or dividers | the label was a catch-all for any wish the particles question did not cover | label removed; an unknown particle wish keeps the particles (no note) |

Not measured: the plan's comparison of the KEEP style against the demo's absolute style (every
answer restates the whole billet). KEEP reached 22/22, so there was nothing to win.
