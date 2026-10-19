# NetworkBase fonts

Unmodified fonts from the official Google Fonts repository, downloaded 7 September 2026. Each family is distributed under the adjacent SIL Open Font License.

- Instrument Sans: https://github.com/google/fonts/tree/main/ofl/instrumentsans (variable width/weight; UI uses normal width, 400–700).
- Instrument Serif: https://github.com/google/fonts/tree/main/ofl/instrumentserif (regular 400).
- JetBrains Mono: https://github.com/google/fonts/tree/main/ofl/jetbrainsmono (variable 100–800).

Next localFont serves these assets locally with display: swap; builds do not require a font CDN connection.

The `*-Share-*.ttf` files are static instances derived from these existing variable fonts for the social-image renderer: Instrument Sans 400/600 and JetBrains Mono 400, with every other axis at its default. They retain the adjacent families' SIL Open Font Licenses. Instantiate with FontTools `fontTools.varLib.instancer.instantiateVariableFont` and save as TTF; no runtime font conversion or remote font lookup is used.
