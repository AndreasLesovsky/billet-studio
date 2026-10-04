# billet-studio roadmap

What billet-studio stands for, what is done, and the phases ahead. Each phase gets its own plan
before work starts; the done phases are listed in [README → Roadmap](../README.md#roadmap).

## Why billet-studio: the promise of the hero

The home hero explains the product in ten seconds, and its headline is the promise:

> **Deine Worte, mit einem Geschenk in 3D.** *(Your words, with a gift in 3D.)*

Its three chapters are the three steps of the product:

1. **Schreib deine Worte** (write your words) — you write them yourself; fonts, colours and
   spacing make them look designed.
2. **Leg ein Geschenk in 3D hinein** (add a gift in 3D) — a real 3D object that the recipient
   turns with a finger, not a video to watch.
3. **Teile es per Link** (share it with a link) — no app; it arrives on any phone within seconds.

**Positioning:** the pop-up card for the phone — your own words with a real 3D gift, designed in
two minutes, sent as a link.
**The feeling it sells:** looks like a lot of effort, takes two minutes.
**The rule for AI:** the AI designs, the words stay yours. The assistant only uses facts the
sender gives, never invents any, and every text it suggests is a draft the sender owns.

### Why not something else?

| What people send today | What is missing | What a billet adds |
|---|---|---|
| Messenger text, GIF, sticker | reads as no effort, forgotten tomorrow | a designed card with a gift |
| Animated e-cards | a clip to watch, generic | own words, a 3D object to turn |
| Paper and pop-up cards | shop, postage, planning, can arrive late | instant, by link |
| "Ask ChatGPT for a page" | code, hosting, finding and optimising a model, phone fixes | two minutes, hosted, curated 3D |

**What lasts** (code can be copied): the quality of the opening moment, an own model library in
one house style with personalisation, and built-in reach — everyone who receives a billet sees
what it can do.

## Done

| Plan | Result |
|---|---|
| App (P0–P8) | CommerceX user management decoupled and reused, catalog and billets with publishing, renderer, editor, account storage, hardening |
| Hero story (H0–H7) | the 3D story on the home page, built from Blender Python scripts, with posters and fallbacks |
| Assistant (A1–A5) | "a billet from one sentence": a local model picks template, theme, 3D motif, particles, divider, appearance and language |

## Phase 1 — A finished billet from one sentence (assistant v2)

Goal: the assistant delivers a complete billet including text drafts written from the sender's
own facts ("my brother Max, 30, loves climbing, we were on the Großglockner this summer, rather
funny").

1. **Measure text quality first.** 30 test briefs (occasions × relationships × tones, DE/EN) and a
   rubric: correct language, personal, free of clichés, fits the length, fits the tone, invents
   nothing. Extend the existing measurement (`AssistEval`) and compare local Ollama models that
   fit in 16 GB VRAM with Claude Haiku 4.5, Sonnet 5.5 and Opus 5.5 (Opus as the quality
   ceiling). Rough cost per billet text at about 2,000 input and 1,500 output tokens (price list
   2026-09): Haiku 4.5 ≈ 0.5 ct, Sonnet 5.5 ≈ 2 ct, Opus 5.5 ≈ 3–4 ct; a local model costs
   nothing per call but needs a GPU server in production. Decide on quality, cost and privacy.
2. **Blueprints.** Structure, design, text slots with hard length limits and example texts per
   blueprint. Versioned files in the repository first (like the templates today); a database
   table only once there is an admin UI. The model only determines features (occasion,
   relationship, tone, style, wished object); code filters the candidates, so the model never
   picks from hundreds.
3. **Text generation.** A second call fills the slots as JSON against a schema with the limits,
   under the facts-only rule; the result is validated against the billet document rules, falls
   back to the blueprint's texts, and opens as a draft in the editor.
4. **Refine in the chat.** "Shorter", "mention Rome", "less sweet" regenerate only the affected
   slots.
5. **Privacy.** If texts go to an external API: a notice in the UI and in the privacy policy;
   personal details are never logged.

## Phase 2 — Own 3D library (model factory)

Goal: replace every Sketchfab model with own models in one house style, then grow the library to
hundreds over time. Own models also end the licence questions: CC-BY needs credits, CC-BY-NC
(the carrot cake) rules out commercial use, and for the Sketchfab Standard licence it is unclear
whether serving the GLB to the browser counts as redistribution.

1. **House style guide:** shapes (soft, rounded, glossy like the beating heart), Principled BSDF
   materials only, palette, lighting reference, triangle and texture budgets, size limits.
2. **Parametric families** as Blender Python scripts (headless, like the hero), each family
   rendered for review. First the five template gifts: heart, cake (tiers, glaze, number of
   candles), champagne with glasses, snow globe, stylised bouquet.
3. **Metadata from every build:** name DE/EN, tags, occasion, style, colours and parameters,
   written into the catalog by a dated SQL migration — it feeds the search and the assistant.
4. **Swap:** templates and hero gifts use the new models; the Sketchfab models get
   `active = 0` (slugs stay, old billets keep rendering); the credit line disappears.
5. **Grow:** balloons with the digits 0–9, gift boxes, candles, stars, baubles, envelopes, mugs,
   trophies, … Organic objects (animals, plush toys, realistic flowers) only through AI 3D
   generators after a licence check (Hunyuan3D's licence reportedly excludes the EU — verify).
6. **Library UX for hundreds of models:** search, tags, filters and lazy previews in the 3D
   picker.

## Phase 3 — Recipient experience and editor

Goal: deepen the moment of opening, where the promise is kept.

1. **Link preview** per billet: an Open Graph image and meta tags for `/b/{token}` (the SPA needs
   server-side meta tags) — the first impression in every messenger.
2. **Envelope moment:** "Für Lisa" → tap → the card opens, continuing the hero story inside the
   real billet.
3. **Personalised 3D gifts:** colour, number of candles = age, a name on the gift tag (needs the
   Phase 2 families; parts and variants come from Blender, names as textures).
4. **Own photos:** a photo block and a hero photo (reusing the avatar image processing).
5. **Opening date** with a countdown ("visible from 14 February, 00:00").
6. **Reply:** the recipient sends a heart or a thank-you, the sender sees "opened", and "answer
   with your own billet" closes the loop.

Later: voice message, AR "place it on your table" (WebXR / Quick Look), group billets, QR code for
a physical gift, image and story export.

## Phase 4 — Product readiness (if it becomes a product)

- **Target group** first: private occasions, or businesses (season's greetings with the
  company's own product or logo as a 3D object, built by the model factory).
- **Business model:** freemium like Canva — a free base library, premium families and
  personalisation paid.
- **Hosting and cost:** text generation via API or a GPU server; models served by the backend
  (`MODELS_DIRECTORY` runbook exists).
- **Legal:** imprint, privacy policy, terms.
- **Hero polish** after the owner's review: the heart turns edge-on at 8.7–9.3 s; the card title
  is about 65 % of the billet title at the hand-over.
- **Lighthouse pass** — deliberately last.

## Open decisions

| Question | Decided in |
|---|---|
| Private occasions or businesses first? | before Phase 4, ideally before Phase 3 |
| Text model: local or API | Phase 1.1 (measurement) |
| The house style (a reference look) | Phase 2.1 |
| Blueprints in files or in the database | when an admin UI comes |
