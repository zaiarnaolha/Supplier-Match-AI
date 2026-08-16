# Supplier Match AI — Design System

## 1. Purpose

This document describes the design-system structure prepared in Figma for the Supplier Match AI landing page.

Use together with:

- `Guideline.md` — implementation rules;
- `references/desktop-en.png` — Desktop EN visual reference;
- `references/desktop-ua.png` — Desktop UA visual reference;
- `references/mobile-en.png` — Mobile EN visual reference;
- `references/mobile-ua.png` — Mobile UA visual reference.

When direct Figma/MCP access is unavailable, these files together are the source of truth.

Do not invent missing design values.

---

## 2. Landing structure

The landing page consists of the following sections, in this order:

1. Header
2. Hero
3. Product Intro
4. Features
5. How It Works
6. FAQ
7. Trust
8. CTA
9. Footer

Code section naming should follow these Figma section names.

Recommended mapping:

- `Header` → `Header`
- `Hero` → `Hero`
- `Product Intro` → `ProductIntro`
- `Features` → `Features`
- `How It Works` → `HowItWorks`
- `FAQ` → `FAQ`
- `Trust` → `Trust`
- `CTA` → `CTA`
- `Footer` → `Footer`

Do not merge unrelated sections or add new sections.

---

## 3. Responsive layouts

The Figma file contains four primary landing references:

- Desktop EN
- Desktop UA
- Mobile EN
- Mobile UA

Corresponding repository references:

- `references/desktop-en.png`
- `references/desktop-ua.png`
- `references/mobile-en.png`
- `references/mobile-ua.png`

Desktop and Mobile are separate responsive references.

Do not implement Mobile by proportionally scaling Desktop.

Use the references to determine:

- stacking;
- content order;
- alignment;
- container behavior;
- card layout;
- navigation behavior;
- section spacing;
- typography hierarchy;
- CTA behavior.

Use Flexbox and CSS Grid for responsive layout.

Avoid horizontal overflow.

Do not invent a breakpoint based only on framework defaults. Choose the CSS transition point required to move naturally between the provided Desktop and Mobile compositions.

---

## 4. Variable collections

The Figma design system contains three variable collections:

### Color

Contains color primitives and semantic color tokens.

Prefer semantic tokens in production UI.

Known semantic token examples include:

- `semantic/action/primary`
- `semantic/surface/default`
- `semantic/border/default`
- `semantic/text/primary`
- `semantic/text/muted`
- `semantic/text/on-primary`

Map Figma semantic variables to CSS custom properties.

Example:

`semantic/action/primary`

becomes:

`--semantic-action-primary`

Do not replace semantic tokens with arbitrary hardcoded colors.

The primary brand/action color used in the prepared design is based on `#4F46E5`.

If an exact color cannot be established from this document or the supplied references, do not invent a new color.

### Spacing

Figma spacing values are organized as reusable variables.

Use spacing tokens instead of scattering unrelated spacing values throughout section styles.

Map them to CSS custom properties where appropriate.

Example naming:

`--spacing-*`

Exact values that are not explicitly available from the supplied design specification must not be invented solely to approximate Figma.

### Radius

Border radius values are organized as reusable Figma variables.

Map reusable radius tokens to:

`--radius-*`

Do not introduce arbitrary additional radius values unless required by the supplied design reference.

---

## 5. Typography Styles

The prepared Figma file contains these typography roles:

- `Display / H1`
- `Heading / H2`
- `Heading / H2 Compact`
- `Heading / H3`
- `Body / Regular`
- `Body / Small`
- `Label / Small`
- `Button / Medium`
- `Brand / Name`

Fonts used in the design system:

- Instrument Sans
- Inter

Preserve the visual hierarchy represented by these roles.

Do not replace the typography with framework or browser default typography when the intended font can be loaded.

Do not create additional typography roles unless required by the supplied references.

If an exact font size, weight, line height or letter spacing is not specified in available project materials, use the visual references to identify the role but do not present an estimated value as an official Figma token.

---

## 6. Effect Styles

The prepared Figma design system contains reusable Effect Styles for shadows.

Use design-system effects for repeated card/surface treatments.

Do not add decorative shadows or effects that do not appear in the supplied landing references.

Keep the visual treatment clean and restrained.

---

## 7. Components

The Figma design system contains the following reusable components:

1. Button
2. Feature Card
3. Step Card
4. FAQ Item
5. Language Switcher
6. Brand Logo

These should map to reusable code components.

Suggested file mapping:

components/
- Button/
- FeatureCard/
- StepCard/
- FAQItem/
- LanguageSwitcher/
- BrandLogo/

Do not duplicate components per section if the same Figma component is reused.

---

## 8. Button

Button is a reusable component with Style × Size variants.

Known styles:

- Primary
- Secondary
- Ghost

Known sizes:

- Small
- Medium
- Large

Implement as one component.

Example API:

`<Button variant="primary" size="medium">...</Button>`

Do not create:

- `PrimaryButton`
- `SecondaryButton`
- `LargeButton`

as independent components.

Primary actions use the semantic primary action color.

Ghost actions should not receive an invented filled background.

Button text must remain editable through children or a label prop.

Use the visual references to determine which variant/size is used for Header, Hero and CTA contexts.

---

## 9. Feature Card

`Feature Card` is a reusable component.

All repeated feature cards should use the same code component.

Content may vary through props/data.

The component should preserve:

- shared structure;
- shared spacing behavior;
- shared typography;
- shared surface treatment.

Do not create a different component for every feature.

---

## 10. Step Card

`Step Card` is used in the `How It Works` section.

Implement one reusable component and provide changing content through props/data.

Preserve the visual order and responsive behavior shown in Desktop and Mobile references.

---

## 11. FAQ Item

`FAQ Item` is a reusable interactive component.

Required states:

- Closed
- Open

Implement state through component behavior/props rather than separate components.

FAQ should be the primary interactive element required by the static landing page.

Do not add functionality not represented by the design.

---

## 12. Language Switcher

`Language Switcher` is a reusable component.

The design contains EN and UA landing variants.

The component should visually correspond to the Figma component and supplied screenshots.

Do not invent additional languages.

If actual runtime language switching is implemented, EN and UA content must come from the supplied design content rather than machine-generated replacement copy.

---

## 13. Brand Logo

`Brand Logo` uses the original vector geometry prepared in Figma.

The same reusable logo should be used wherever the brand logo repeats, including Header/Footer where shown.

Do not approximate the logo with a generic icon, emoji or unrelated symbol.

If the original vector asset is unavailable in the repository, report the missing asset instead of inventing a replacement.

---

## 14. Component usage

The prepared landing uses component instances rather than duplicated raw frames for major repeated UI.

The Figma handoff contains instances of:

- Button
- Feature Card
- Step Card
- FAQ Item
- Language Switcher
- Brand Logo

Maintain the same principle in code.

Repeated content should preferably be rendered from structured data where appropriate.

Example:

`features.map(...)`

rather than manually duplicating identical component markup.

---

## 15. Layout principles

Figma Auto Layout should translate primarily to:

- Flexbox;
- CSS Grid;
- normal document flow.

Do not convert Figma X/Y coordinates directly into absolute CSS positioning.

Absolute positioning is allowed only for genuine overlays or decorative elements whose visual relationship requires it.

Section layout should remain maintainable and responsive.

---

## 16. Design token implementation

Create a global token layer, for example:

`src/styles/tokens.css`

Prefer CSS custom properties.

Example structure:

`:root { ... }`

Organize variables conceptually into:

- color;
- semantic color;
- spacing;
- radius;
- typography-related reusable values where appropriate.

Component CSS should consume these tokens rather than recreate design values locally.

Do not claim guessed values are exported Figma tokens.

---

## 17. Visual source priority

When Figma MCP is unavailable, use sources in this order:

1. `design-system.md` for system structure and component semantics;
2. the corresponding PNG reference for visual composition;
3. `Guideline.md` for implementation constraints.

For Desktop EN use:

`references/desktop-en.png`

For Desktop UA use:

`references/desktop-ua.png`

For Mobile EN use:

`references/mobile-en.png`

For Mobile UA use:

`references/mobile-ua.png`

If these sources conflict or leave an important implementation value unclear, report the ambiguity instead of silently redesigning the interface.

---

## 18. Content

Copy text exactly from the supplied visual references/project materials.

Do not rewrite:

- headings;
- body copy;
- CTA labels;
- FAQ questions;
- FAQ answers;
- navigation labels.

Do not add new marketing claims.

---

## 19. Implementation mapping

Recommended React structure:

src/
- components/
  - Button/
  - FeatureCard/
  - StepCard/
  - FAQItem/
  - LanguageSwitcher/
  - BrandLogo/
- sections/
  - Header/
  - Hero/
  - ProductIntro/
  - Features/
  - HowItWorks/
  - FAQ/
  - Trust/
  - CTA/
  - Footer/
- styles/
  - tokens.css
  - globals.css
- assets/

Keep architecture simple.

Do not introduce a UI framework or additional state-management library unless explicitly approved.

---

## 20. Visual QA

For each completed section compare implementation against the supplied Desktop and Mobile references.

Check:

- content;
- hierarchy;
- alignment;
- component reuse;
- typography hierarchy;
- colors;
- spacing;
- radius;
- responsive stacking;
- width behavior;
- overflow.

The final implementation must be checked against all four references:

- Desktop EN
- Desktop UA
- Mobile EN
- Mobile UA

Do not mark the implementation complete while obvious visual differences remain unexplained.

---

## 21. Known limitation of this handoff

Direct Figma MCP access is unavailable in the current Codex Web environment.

Therefore this document describes the verified design-system structure prepared for Supplier Match AI, while the supplied PNG files provide the visual reference.

Not every exact numeric Figma token value is reproduced in this document.

Do not invent missing token values and describe them as Figma values.

If an exact value is necessary and cannot be reliably established from the supplied materials, report it before proceeding.
