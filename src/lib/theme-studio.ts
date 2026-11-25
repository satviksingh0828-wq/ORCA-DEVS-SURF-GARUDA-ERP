/**
 * ORCA Theme Studio v2
 * Uses the existing app_settings.theme TEXT column. Legacy theme IDs remain valid.
 * The v2 payload is deliberately bounded, validated and serializable.
 */
export const THEME_PROFILE_PREFIX = "orca-theme-v2:";

export const MATERIAL_THEME_PRESETS = [
  {
    "id": "walnut",
    "name": "Walnut",
    "description": "Rich executive walnut",
    "group": "Wood",
    "swatch": "#80502E",
    "dark": false,
    "colors": {
      "primary": "#80502E",
      "primaryForeground": "#FFFFFF",
      "background": "#EDE2D3",
      "foreground": "#38251C",
      "card": "#FAF4E9",
      "cardForeground": "#38251C",
      "secondary": "#E0D5C6",
      "secondaryForeground": "#6B5A4F",
      "muted": "#E0D5C6",
      "mutedForeground": "#6B5A4F",
      "popover": "#FAF4E9",
      "popoverForeground": "#38251C",
      "border": "#C2B5A7",
      "input": "#C2B5A7",
      "ring": "#80502E",
      "sidebar": "#493021",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#594234",
      "sidebarAccent": "#80502E",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#735E50",
      "wmsAccent": "#80502E",
      "videoPanelBackground": "#FAF4E9",
      "videoPanelText": "#38251C",
      "footerBackground": "#493021",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#80502E"
    }
  },
  {
    "id": "oak",
    "name": "Oak",
    "description": "Light natural oak",
    "group": "Wood",
    "swatch": "#8C5D2C",
    "dark": false,
    "colors": {
      "primary": "#8C5D2C",
      "primaryForeground": "#FFFFFF",
      "background": "#F3E9D6",
      "foreground": "#3A2D20",
      "card": "#FFFAEF",
      "cardForeground": "#3A2D20",
      "secondary": "#E6DCC9",
      "secondaryForeground": "#695E50",
      "muted": "#E6DCC9",
      "mutedForeground": "#695E50",
      "popover": "#FFFAEF",
      "popoverForeground": "#3A2D20",
      "border": "#C7BCAA",
      "input": "#C7BCAA",
      "ring": "#8C5D2C",
      "sidebar": "#60452E",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#6E553F",
      "sidebarAccent": "#8C5D2C",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#856E5A",
      "wmsAccent": "#8C5D2C",
      "videoPanelBackground": "#FFFAEF",
      "videoPanelText": "#3A2D20",
      "footerBackground": "#60452E",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#8C5D2C"
    }
  },
  {
    "id": "teak",
    "name": "Teak",
    "description": "Polished golden teak",
    "group": "Wood",
    "swatch": "#986022",
    "dark": false,
    "colors": {
      "primary": "#986022",
      "primaryForeground": "#FFFFFF",
      "background": "#F3E5C9",
      "foreground": "#3D291A",
      "card": "#FFF6E3",
      "cardForeground": "#3D291A",
      "secondary": "#E6D8BD",
      "secondaryForeground": "#6B5A48",
      "muted": "#E6D8BD",
      "mutedForeground": "#6B5A48",
      "popover": "#FFF6E3",
      "popoverForeground": "#3D291A",
      "border": "#C7B89F",
      "input": "#C7B89F",
      "ring": "#986022",
      "sidebar": "#624020",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#705133",
      "sidebarAccent": "#986022",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#866B50",
      "wmsAccent": "#986022",
      "videoPanelBackground": "#FFF6E3",
      "videoPanelText": "#3D291A",
      "footerBackground": "#624020",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#986022"
    }
  },
  {
    "id": "rosewood",
    "name": "Rosewood",
    "description": "Deep reddish luxury wood",
    "group": "Wood",
    "swatch": "#923F4B",
    "dark": false,
    "colors": {
      "primary": "#923F4B",
      "primaryForeground": "#FFFFFF",
      "background": "#F1DFDB",
      "foreground": "#41232A",
      "card": "#FCF3EE",
      "cardForeground": "#41232A",
      "secondary": "#E5D2CF",
      "secondaryForeground": "#6D5458",
      "muted": "#E5D2CF",
      "mutedForeground": "#6D5458",
      "popover": "#FCF3EE",
      "popoverForeground": "#41232A",
      "border": "#C7B2B1",
      "input": "#C7B2B1",
      "ring": "#923F4B",
      "sidebar": "#51252A",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#61383C",
      "sidebarAccent": "#923F4B",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#795657",
      "wmsAccent": "#923F4B",
      "videoPanelBackground": "#FCF3EE",
      "videoPanelText": "#41232A",
      "footerBackground": "#51252A",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#923F4B"
    }
  },
  {
    "id": "mahogany",
    "name": "Mahogany",
    "description": "Elegant dark red-brown wood",
    "group": "Wood",
    "swatch": "#E1A175",
    "dark": true,
    "colors": {
      "primary": "#E1A175",
      "primaryForeground": "#111111",
      "background": "#241612",
      "foreground": "#F8E7D8",
      "card": "#33221D",
      "cardForeground": "#F8E7D8",
      "secondary": "#332520",
      "secondaryForeground": "#BDACA1",
      "muted": "#332520",
      "mutedForeground": "#BDACA1",
      "popover": "#33221D",
      "popoverForeground": "#F8E7D8",
      "border": "#574842",
      "input": "#574842",
      "ring": "#E1A175",
      "sidebar": "#3B211B",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#4C342E",
      "sidebarAccent": "#E1A175",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#66514B",
      "wmsAccent": "#E1A175",
      "videoPanelBackground": "#33221D",
      "videoPanelText": "#F8E7D8",
      "footerBackground": "#3B211B",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#E1A175"
    }
  },
  {
    "id": "pine",
    "name": "Pine",
    "description": "Pale soft wood",
    "group": "Wood",
    "swatch": "#78602E",
    "dark": false,
    "colors": {
      "primary": "#78602E",
      "primaryForeground": "#FFFFFF",
      "background": "#F8F1DF",
      "foreground": "#383020",
      "card": "#FFFCF2",
      "cardForeground": "#383020",
      "secondary": "#EBE3D2",
      "secondaryForeground": "#696252",
      "muted": "#EBE3D2",
      "mutedForeground": "#696252",
      "popover": "#FFFCF2",
      "popoverForeground": "#383020",
      "border": "#CAC3B1",
      "input": "#CAC3B1",
      "ring": "#78602E",
      "sidebar": "#63513A",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#71604A",
      "sidebarAccent": "#78602E",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#877864",
      "wmsAccent": "#78602E",
      "videoPanelBackground": "#FFFCF2",
      "videoPanelText": "#383020",
      "footerBackground": "#63513A",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#78602E"
    }
  },
  {
    "id": "cedar",
    "name": "Cedar",
    "description": "Warm earthy cedar",
    "group": "Wood",
    "swatch": "#A05035",
    "dark": false,
    "colors": {
      "primary": "#A05035",
      "primaryForeground": "#FFFFFF",
      "background": "#F1E1CF",
      "foreground": "#43291F",
      "card": "#FFF5EA",
      "cardForeground": "#43291F",
      "secondary": "#E5D4C3",
      "secondaryForeground": "#6F594D",
      "muted": "#E5D4C3",
      "mutedForeground": "#6F594D",
      "popover": "#FFF5EA",
      "popoverForeground": "#43291F",
      "border": "#C7B5A5",
      "input": "#C7B5A5",
      "ring": "#A05035",
      "sidebar": "#5F392A",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#6D4A3C",
      "sidebarAccent": "#A05035",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#846557",
      "wmsAccent": "#A05035",
      "videoPanelBackground": "#FFF5EA",
      "videoPanelText": "#43291F",
      "footerBackground": "#5F392A",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#A05035"
    }
  },
  {
    "id": "bamboo",
    "name": "Bamboo",
    "description": "Fresh golden green bamboo",
    "group": "Wood",
    "swatch": "#65763A",
    "dark": false,
    "colors": {
      "primary": "#65763A",
      "primaryForeground": "#FFFFFF",
      "background": "#F3F1DA",
      "foreground": "#343C25",
      "card": "#FCFBEF",
      "cardForeground": "#343C25",
      "secondary": "#E6E4CD",
      "secondaryForeground": "#606651",
      "muted": "#E6E4CD",
      "mutedForeground": "#606651",
      "popover": "#FCFBEF",
      "popoverForeground": "#343C25",
      "border": "#C5C6AF",
      "input": "#C5C6AF",
      "ring": "#65763A",
      "sidebar": "#465239",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#576149",
      "sidebarAccent": "#65763A",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#717863",
      "wmsAccent": "#65763A",
      "videoPanelBackground": "#FCFBEF",
      "videoPanelText": "#343C25",
      "footerBackground": "#465239",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#65763A"
    }
  },
  {
    "id": "ebony-wood",
    "name": "Ebony Wood",
    "description": "Nearly black fine-grained wood",
    "group": "Wood",
    "swatch": "#D2BC97",
    "dark": true,
    "colors": {
      "primary": "#D2BC97",
      "primaryForeground": "#111111",
      "background": "#151310",
      "foreground": "#F3ECE0",
      "card": "#2D2822",
      "cardForeground": "#F3ECE0",
      "secondary": "#25221F",
      "secondaryForeground": "#B5AFA6",
      "muted": "#25221F",
      "mutedForeground": "#B5AFA6",
      "popover": "#2D2822",
      "popoverForeground": "#F3ECE0",
      "border": "#4A4742",
      "input": "#4A4742",
      "ring": "#D2BC97",
      "sidebar": "#24201C",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#37332F",
      "sidebarAccent": "#D2BC97",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#55514C",
      "wmsAccent": "#D2BC97",
      "videoPanelBackground": "#2D2822",
      "videoPanelText": "#F3ECE0",
      "footerBackground": "#24201C",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#D2BC97"
    }
  },
  {
    "id": "driftwood",
    "name": "Driftwood",
    "description": "Weathered grey wood",
    "group": "Wood",
    "swatch": "#5C6B69",
    "dark": false,
    "colors": {
      "primary": "#5C6B69",
      "primaryForeground": "#FFFFFF",
      "background": "#E9E7E1",
      "foreground": "#303634",
      "card": "#F8F7F3",
      "cardForeground": "#303634",
      "secondary": "#DCDBD5",
      "secondaryForeground": "#5C5F5C",
      "muted": "#DCDBD5",
      "mutedForeground": "#5C5F5C",
      "popover": "#F8F7F3",
      "popoverForeground": "#303634",
      "border": "#BDBDB7",
      "input": "#BDBDB7",
      "ring": "#5C6B69",
      "sidebar": "#4F5351",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#5F625F",
      "sidebarAccent": "#5C6B69",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#777975",
      "wmsAccent": "#5C6B69",
      "videoPanelBackground": "#F8F7F3",
      "videoPanelText": "#303634",
      "footerBackground": "#4F5351",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#5C6B69"
    }
  },
  {
    "id": "parchment",
    "name": "Parchment",
    "description": "Warm classic writing paper",
    "group": "Office",
    "swatch": "#8C652B",
    "dark": false,
    "colors": {
      "primary": "#8C652B",
      "primaryForeground": "#FFFFFF",
      "background": "#F6EED9",
      "foreground": "#423421",
      "card": "#FFF9EB",
      "cardForeground": "#423421",
      "secondary": "#E9E1CC",
      "secondaryForeground": "#6A5F4E",
      "muted": "#E9E1CC",
      "mutedForeground": "#6A5F4E",
      "popover": "#FFF9EB",
      "popoverForeground": "#423421",
      "border": "#CBC1AD",
      "input": "#CBC1AD",
      "ring": "#8C652B",
      "sidebar": "#544631",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#635642",
      "sidebarAccent": "#8C652B",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#7B6F5D",
      "wmsAccent": "#8C652B",
      "videoPanelBackground": "#FFF9EB",
      "videoPanelText": "#423421",
      "footerBackground": "#544631",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#8C652B"
    }
  },
  {
    "id": "ledger",
    "name": "Ledger",
    "description": "Classic accounting book",
    "group": "Office",
    "swatch": "#38654D",
    "dark": false,
    "colors": {
      "primary": "#38654D",
      "primaryForeground": "#FFFFFF",
      "background": "#EDEFE4",
      "foreground": "#253B30",
      "card": "#FCFAEE",
      "cardForeground": "#253B30",
      "secondary": "#DFE2D7",
      "secondaryForeground": "#55645A",
      "muted": "#DFE2D7",
      "mutedForeground": "#55645A",
      "popover": "#FCFAEE",
      "popoverForeground": "#253B30",
      "border": "#BDC4B9",
      "input": "#BDC4B9",
      "ring": "#38654D",
      "sidebar": "#30493E",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#43594E",
      "sidebarAccent": "#38654D",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#607167",
      "wmsAccent": "#38654D",
      "videoPanelBackground": "#FCFAEE",
      "videoPanelText": "#253B30",
      "footerBackground": "#30493E",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#38654D"
    }
  },
  {
    "id": "stationery",
    "name": "Stationery",
    "description": "Clean polished office paper",
    "group": "Office",
    "swatch": "#526B8E",
    "dark": false,
    "colors": {
      "primary": "#526B8E",
      "primaryForeground": "#FFFFFF",
      "background": "#F4F5F7",
      "foreground": "#283443",
      "card": "#FFFFFF",
      "cardForeground": "#283443",
      "secondary": "#E6E7EA",
      "secondaryForeground": "#5D6670",
      "muted": "#E6E7EA",
      "mutedForeground": "#5D6670",
      "popover": "#FFFFFF",
      "popoverForeground": "#283443",
      "border": "#C3C7CC",
      "input": "#C3C7CC",
      "ring": "#526B8E",
      "sidebar": "#3F4B5F",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#505B6C",
      "sidebarAccent": "#526B8E",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#6B7380",
      "wmsAccent": "#526B8E",
      "videoPanelBackground": "#FFFFFF",
      "videoPanelText": "#283443",
      "footerBackground": "#3F4B5F",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#526B8E"
    }
  },
  {
    "id": "manila",
    "name": "Manila",
    "description": "Manila folders and warm neutrals",
    "group": "Office",
    "swatch": "#886022",
    "dark": false,
    "colors": {
      "primary": "#886022",
      "primaryForeground": "#FFFFFF",
      "background": "#F5E8C8",
      "foreground": "#413420",
      "card": "#FFF8E6",
      "cardForeground": "#413420",
      "secondary": "#E8DBBC",
      "secondaryForeground": "#695E49",
      "muted": "#E8DBBC",
      "mutedForeground": "#695E49",
      "popover": "#FFF8E6",
      "popoverForeground": "#413420",
      "border": "#CABDA0",
      "input": "#CABDA0",
      "ring": "#886022",
      "sidebar": "#59462D",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#68563E",
      "sidebarAccent": "#886022",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#7F6F5A",
      "wmsAccent": "#886022",
      "videoPanelBackground": "#FFF8E6",
      "videoPanelText": "#413420",
      "footerBackground": "#59462D",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#886022"
    }
  },
  {
    "id": "invoice",
    "name": "Invoice",
    "description": "Clear document-first blue and white",
    "group": "Office",
    "swatch": "#2761A0",
    "dark": false,
    "colors": {
      "primary": "#2761A0",
      "primaryForeground": "#FFFFFF",
      "background": "#F2F6FC",
      "foreground": "#26394D",
      "card": "#FFFFFF",
      "cardForeground": "#26394D",
      "secondary": "#E4E9F0",
      "secondaryForeground": "#5B6979",
      "muted": "#E4E9F0",
      "mutedForeground": "#5B6979",
      "popover": "#FFFFFF",
      "popoverForeground": "#26394D",
      "border": "#C1C9D2",
      "input": "#C1C9D2",
      "ring": "#2761A0",
      "sidebar": "#26425F",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#3A526C",
      "sidebarAccent": "#2761A0",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#586C80",
      "wmsAccent": "#2761A0",
      "videoPanelBackground": "#FFFFFF",
      "videoPanelText": "#26394D",
      "footerBackground": "#26425F",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#2761A0"
    }
  },
  {
    "id": "archive",
    "name": "Archive",
    "description": "Muted aged records",
    "group": "Office",
    "swatch": "#77614D",
    "dark": false,
    "colors": {
      "primary": "#77614D",
      "primaryForeground": "#FFFFFF",
      "background": "#EDE5D7",
      "foreground": "#3C342B",
      "card": "#F9F5EB",
      "cardForeground": "#3C342B",
      "secondary": "#E1D9CB",
      "secondaryForeground": "#655E54",
      "muted": "#E1D9CB",
      "mutedForeground": "#655E54",
      "popover": "#F9F5EB",
      "popoverForeground": "#3C342B",
      "border": "#C3BBAE",
      "input": "#C3BBAE",
      "ring": "#77614D",
      "sidebar": "#51463C",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#61564C",
      "sidebarAccent": "#77614D",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#796F65",
      "wmsAccent": "#77614D",
      "videoPanelBackground": "#F9F5EB",
      "videoPanelText": "#3C342B",
      "footerBackground": "#51463C",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#77614D"
    }
  },
  {
    "id": "cargo",
    "name": "Cargo",
    "description": "Charcoal and safety yellow",
    "group": "Industrial",
    "swatch": "#F4C430",
    "dark": true,
    "colors": {
      "primary": "#F4C430",
      "primaryForeground": "#111111",
      "background": "#252729",
      "foreground": "#F5F5F5",
      "card": "#333638",
      "cardForeground": "#F5F5F5",
      "secondary": "#343537",
      "secondaryForeground": "#BBBBBC",
      "muted": "#343537",
      "mutedForeground": "#BBBBBC",
      "popover": "#333638",
      "popoverForeground": "#F5F5F5",
      "border": "#57585A",
      "input": "#57585A",
      "ring": "#F4C430",
      "sidebar": "#17191B",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#2B2D2E",
      "sidebarAccent": "#F4C430",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#4B4B4B",
      "wmsAccent": "#F4C430",
      "videoPanelBackground": "#333638",
      "videoPanelText": "#F5F5F5",
      "footerBackground": "#17191B",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#F4C430"
    }
  },
  {
    "id": "container",
    "name": "Container",
    "description": "Shipping blue and rust orange",
    "group": "Industrial",
    "swatch": "#F0A16A",
    "dark": true,
    "colors": {
      "primary": "#F0A16A",
      "primaryForeground": "#111111",
      "background": "#132B3D",
      "foreground": "#EAF4FA",
      "card": "#203D50",
      "cardForeground": "#EAF4FA",
      "secondary": "#22394A",
      "secondaryForeground": "#AEBCC5",
      "muted": "#22394A",
      "mutedForeground": "#AEBCC5",
      "popover": "#203D50",
      "popoverForeground": "#EAF4FA",
      "border": "#475B6A",
      "input": "#475B6A",
      "ring": "#F0A16A",
      "sidebar": "#102233",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#253544",
      "sidebarAccent": "#F0A16A",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#45525E",
      "wmsAccent": "#F0A16A",
      "videoPanelBackground": "#203D50",
      "videoPanelText": "#EAF4FA",
      "footerBackground": "#102233",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#F0A16A"
    }
  },
  {
    "id": "freight",
    "name": "Freight",
    "description": "Deep navy and amber",
    "group": "Industrial",
    "swatch": "#F3B74C",
    "dark": true,
    "colors": {
      "primary": "#F3B74C",
      "primaryForeground": "#111111",
      "background": "#14243A",
      "foreground": "#F0F4FA",
      "card": "#23354C",
      "cardForeground": "#F0F4FA",
      "secondary": "#233347",
      "secondaryForeground": "#B2BAC4",
      "muted": "#233347",
      "mutedForeground": "#B2BAC4",
      "popover": "#23354C",
      "popoverForeground": "#F0F4FA",
      "border": "#495668",
      "input": "#495668",
      "ring": "#F3B74C",
      "sidebar": "#101B2C",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#252E3D",
      "sidebarAccent": "#F3B74C",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#454D58",
      "wmsAccent": "#F3B74C",
      "videoPanelBackground": "#23354C",
      "videoPanelText": "#F0F4FA",
      "footerBackground": "#101B2C",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#F3B74C"
    }
  },
  {
    "id": "dockyard",
    "name": "Dockyard",
    "description": "Port grey and teal",
    "group": "Industrial",
    "swatch": "#227B79",
    "dark": false,
    "colors": {
      "primary": "#227B79",
      "primaryForeground": "#FFFFFF",
      "background": "#E8EFF0",
      "foreground": "#243B40",
      "card": "#F7FAFA",
      "cardForeground": "#243B40",
      "secondary": "#DAE2E4",
      "secondaryForeground": "#546467",
      "muted": "#DAE2E4",
      "mutedForeground": "#546467",
      "popover": "#F7FAFA",
      "popoverForeground": "#243B40",
      "border": "#B9C4C6",
      "input": "#B9C4C6",
      "ring": "#227B79",
      "sidebar": "#29464A",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#3C5659",
      "sidebarAccent": "#227B79",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#5A6F70",
      "wmsAccent": "#227B79",
      "videoPanelBackground": "#F7FAFA",
      "videoPanelText": "#243B40",
      "footerBackground": "#29464A",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#227B79"
    }
  },
  {
    "id": "warehouse",
    "name": "Warehouse",
    "description": "Concrete grey and safety yellow",
    "group": "Industrial",
    "swatch": "#8A6200",
    "dark": false,
    "colors": {
      "primary": "#8A6200",
      "primaryForeground": "#FFFFFF",
      "background": "#E9EBED",
      "foreground": "#2E343A",
      "card": "#FAFAFA",
      "cardForeground": "#2E343A",
      "secondary": "#DCDEE0",
      "secondaryForeground": "#5E6367",
      "muted": "#DCDEE0",
      "mutedForeground": "#5E6367",
      "popover": "#FAFAFA",
      "popoverForeground": "#2E343A",
      "border": "#BCBFC2",
      "input": "#BCBFC2",
      "ring": "#8A6200",
      "sidebar": "#343B42",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#464C52",
      "sidebarAccent": "#8A6200",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#63676A",
      "wmsAccent": "#8A6200",
      "videoPanelBackground": "#FAFAFA",
      "videoPanelText": "#2E343A",
      "footerBackground": "#343B42",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#8A6200"
    }
  },
  {
    "id": "steel",
    "name": "Steel",
    "description": "Metallic grey and blue",
    "group": "Industrial",
    "swatch": "#356994",
    "dark": false,
    "colors": {
      "primary": "#356994",
      "primaryForeground": "#FFFFFF",
      "background": "#E5EBF0",
      "foreground": "#293C4B",
      "card": "#F7FAFC",
      "cardForeground": "#293C4B",
      "secondary": "#D8DFE4",
      "secondaryForeground": "#56646F",
      "muted": "#D8DFE4",
      "mutedForeground": "#56646F",
      "popover": "#F7FAFC",
      "popoverForeground": "#293C4B",
      "border": "#B8C1C8",
      "input": "#B8C1C8",
      "ring": "#356994",
      "sidebar": "#34485A",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#465867",
      "sidebarAccent": "#356994",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#63717C",
      "wmsAccent": "#356994",
      "videoPanelBackground": "#F7FAFC",
      "videoPanelText": "#293C4B",
      "footerBackground": "#34485A",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#356994"
    }
  },
  {
    "id": "ironworks",
    "name": "Ironworks",
    "description": "Dark rugged steel",
    "group": "Industrial",
    "swatch": "#C8A17C",
    "dark": true,
    "colors": {
      "primary": "#C8A17C",
      "primaryForeground": "#111111",
      "background": "#25292F",
      "foreground": "#E9EDF1",
      "card": "#343A43",
      "cardForeground": "#E9EDF1",
      "secondary": "#33373D",
      "secondaryForeground": "#B2B6BB",
      "muted": "#33373D",
      "mutedForeground": "#B2B6BB",
      "popover": "#343A43",
      "popoverForeground": "#E9EDF1",
      "border": "#54585E",
      "input": "#54585E",
      "ring": "#C8A17C",
      "sidebar": "#1A1D22",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#2E3034",
      "sidebarAccent": "#C8A17C",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#4D4E51",
      "wmsAccent": "#C8A17C",
      "videoPanelBackground": "#343A43",
      "videoPanelText": "#E9EDF1",
      "footerBackground": "#1A1D22",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#C8A17C"
    }
  },
  {
    "id": "asphalt",
    "name": "Asphalt",
    "description": "Road charcoal and yellow",
    "group": "Industrial",
    "swatch": "#EBCB51",
    "dark": true,
    "colors": {
      "primary": "#EBCB51",
      "primaryForeground": "#111111",
      "background": "#1E2022",
      "foreground": "#F5F3E9",
      "card": "#303338",
      "cardForeground": "#F5F3E9",
      "secondary": "#2D2F30",
      "secondaryForeground": "#B9B8B1",
      "muted": "#2D2F30",
      "mutedForeground": "#B9B8B1",
      "popover": "#303338",
      "popoverForeground": "#F5F3E9",
      "border": "#525352",
      "input": "#525352",
      "ring": "#EBCB51",
      "sidebar": "#101113",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#252527",
      "sidebarAccent": "#EBCB51",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#454545",
      "wmsAccent": "#EBCB51",
      "videoPanelBackground": "#303338",
      "videoPanelText": "#F5F3E9",
      "footerBackground": "#101113",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#EBCB51"
    }
  },
  {
    "id": "obsidian",
    "name": "Obsidian",
    "description": "AMOLED black and silver",
    "group": "Premium",
    "swatch": "#EDEDED",
    "dark": true,
    "colors": {
      "primary": "#EDEDED",
      "primaryForeground": "#111111",
      "background": "#080808",
      "foreground": "#FFFFFF",
      "card": "#202020",
      "cardForeground": "#FFFFFF",
      "secondary": "#191919",
      "secondaryForeground": "#BABABA",
      "muted": "#191919",
      "mutedForeground": "#BABABA",
      "popover": "#202020",
      "popoverForeground": "#FFFFFF",
      "border": "#434343",
      "input": "#434343",
      "ring": "#EDEDED",
      "sidebar": "#171717",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#2B2B2A",
      "sidebarAccent": "#EDEDED",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#4B4A48",
      "wmsAccent": "#EDEDED",
      "videoPanelBackground": "#202020",
      "videoPanelText": "#FFFFFF",
      "footerBackground": "#171717",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#EDEDED"
    }
  },
  {
    "id": "graphene",
    "name": "Graphene",
    "description": "Dark graphite and cyan",
    "group": "Premium",
    "swatch": "#59CFE3",
    "dark": true,
    "colors": {
      "primary": "#59CFE3",
      "primaryForeground": "#111111",
      "background": "#141A20",
      "foreground": "#E7F3F6",
      "card": "#252F39",
      "cardForeground": "#E7F3F6",
      "secondary": "#23292F",
      "secondaryForeground": "#ACB6BA",
      "muted": "#23292F",
      "mutedForeground": "#ACB6BA",
      "popover": "#252F39",
      "popoverForeground": "#E7F3F6",
      "border": "#474E53",
      "input": "#474E53",
      "ring": "#59CFE3",
      "sidebar": "#1E252D",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#32383E",
      "sidebarAccent": "#59CFE3",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#505459",
      "wmsAccent": "#59CFE3",
      "videoPanelBackground": "#252F39",
      "videoPanelText": "#E7F3F6",
      "footerBackground": "#1E252D",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#59CFE3"
    }
  },
  {
    "id": "onyx",
    "name": "Onyx",
    "description": "Black and polished silver",
    "group": "Premium",
    "swatch": "#C3C9D5",
    "dark": true,
    "colors": {
      "primary": "#C3C9D5",
      "primaryForeground": "#111111",
      "background": "#111216",
      "foreground": "#EFF1F6",
      "card": "#282B32",
      "cardForeground": "#EFF1F6",
      "secondary": "#212226",
      "secondaryForeground": "#B1B3B7",
      "muted": "#212226",
      "mutedForeground": "#B1B3B7",
      "popover": "#282B32",
      "popoverForeground": "#EFF1F6",
      "border": "#46484C",
      "input": "#46484C",
      "ring": "#C3C9D5",
      "sidebar": "#1C1E24",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#303136",
      "sidebarAccent": "#C3C9D5",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#4E4F52",
      "wmsAccent": "#C3C9D5",
      "videoPanelBackground": "#282B32",
      "videoPanelText": "#EFF1F6",
      "footerBackground": "#1C1E24",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#C3C9D5"
    }
  },
  {
    "id": "bordeaux",
    "name": "Bordeaux",
    "description": "Wine red and dark neutral",
    "group": "Premium",
    "swatch": "#E7A2B8",
    "dark": true,
    "colors": {
      "primary": "#E7A2B8",
      "primaryForeground": "#111111",
      "background": "#24171F",
      "foreground": "#F8EBF0",
      "card": "#382532",
      "cardForeground": "#F8EBF0",
      "secondary": "#33262E",
      "secondaryForeground": "#BDB0B5",
      "muted": "#33262E",
      "mutedForeground": "#BDB0B5",
      "popover": "#382532",
      "popoverForeground": "#F8EBF0",
      "border": "#574A51",
      "input": "#574A51",
      "ring": "#E7A2B8",
      "sidebar": "#321C29",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#442F3B",
      "sidebarAccent": "#E7A2B8",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#5F4D56",
      "wmsAccent": "#E7A2B8",
      "videoPanelBackground": "#382532",
      "videoPanelText": "#F8EBF0",
      "footerBackground": "#321C29",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#E7A2B8"
    }
  },
  {
    "id": "imperial",
    "name": "Imperial",
    "description": "Luxury black and gold",
    "group": "Premium",
    "swatch": "#D4AF37",
    "dark": true,
    "colors": {
      "primary": "#D4AF37",
      "primaryForeground": "#111111",
      "background": "#15130F",
      "foreground": "#F5E9CB",
      "card": "#2B251B",
      "cardForeground": "#F5E9CB",
      "secondary": "#25221C",
      "secondaryForeground": "#B6AD96",
      "muted": "#25221C",
      "mutedForeground": "#B6AD96",
      "popover": "#2B251B",
      "popoverForeground": "#F5E9CB",
      "border": "#4B463C",
      "input": "#4B463C",
      "ring": "#D4AF37",
      "sidebar": "#211C13",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#342F27",
      "sidebarAccent": "#D4AF37",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#524D45",
      "wmsAccent": "#D4AF37",
      "videoPanelBackground": "#2B251B",
      "videoPanelText": "#F5E9CB",
      "footerBackground": "#211C13",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#D4AF37"
    }
  },
  {
    "id": "monarch",
    "name": "Monarch",
    "description": "Royal purple and muted gold",
    "group": "Premium",
    "swatch": "#D9BA79",
    "dark": true,
    "colors": {
      "primary": "#D9BA79",
      "primaryForeground": "#111111",
      "background": "#211B35",
      "foreground": "#F0EAFB",
      "card": "#352C4B",
      "cardForeground": "#F0EAFB",
      "secondary": "#2F2943",
      "secondaryForeground": "#B6B0C4",
      "muted": "#2F2943",
      "mutedForeground": "#B6B0C4",
      "popover": "#352C4B",
      "popoverForeground": "#F0EAFB",
      "border": "#534D65",
      "input": "#534D65",
      "ring": "#D9BA79",
      "sidebar": "#2B2144",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#3D3453",
      "sidebarAccent": "#D9BA79",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#5A516B",
      "wmsAccent": "#D9BA79",
      "videoPanelBackground": "#352C4B",
      "videoPanelText": "#F0EAFB",
      "footerBackground": "#2B2144",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#D9BA79"
    }
  },
  {
    "id": "sage",
    "name": "Sage",
    "description": "Muted natural green",
    "group": "Modern",
    "swatch": "#55764F",
    "dark": false,
    "colors": {
      "primary": "#55764F",
      "primaryForeground": "#FFFFFF",
      "background": "#EFF2E8",
      "foreground": "#334432",
      "card": "#FCFDF7",
      "cardForeground": "#334432",
      "secondary": "#E2E6DB",
      "secondaryForeground": "#5B6658",
      "muted": "#E2E6DB",
      "mutedForeground": "#5B6658",
      "popover": "#FCFDF7",
      "popoverForeground": "#334432",
      "border": "#C2C8BC",
      "input": "#C2C8BC",
      "ring": "#55764F",
      "sidebar": "#465746",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#576655",
      "sidebarAccent": "#55764F",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#717C6D",
      "wmsAccent": "#55764F",
      "videoPanelBackground": "#FCFDF7",
      "videoPanelText": "#334432",
      "footerBackground": "#465746",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#55764F"
    }
  },
  {
    "id": "sandstone",
    "name": "Sandstone",
    "description": "Soft beige stone",
    "group": "Modern",
    "swatch": "#8B674A",
    "dark": false,
    "colors": {
      "primary": "#8B674A",
      "primaryForeground": "#FFFFFF",
      "background": "#F1EAE1",
      "foreground": "#453A30",
      "card": "#FCF8F2",
      "cardForeground": "#453A30",
      "secondary": "#E5DED5",
      "secondaryForeground": "#665E56",
      "muted": "#E5DED5",
      "mutedForeground": "#665E56",
      "popover": "#FCF8F2",
      "popoverForeground": "#453A30",
      "border": "#C8C0B7",
      "input": "#C8C0B7",
      "ring": "#8B674A",
      "sidebar": "#665749",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#746658",
      "sidebarAccent": "#8B674A",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#897C6F",
      "wmsAccent": "#8B674A",
      "videoPanelBackground": "#FCF8F2",
      "videoPanelText": "#453A30",
      "footerBackground": "#665749",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#8B674A"
    }
  },
  {
    "id": "clay",
    "name": "Clay",
    "description": "Warm grounded terracotta",
    "group": "Modern",
    "swatch": "#A04E37",
    "dark": false,
    "colors": {
      "primary": "#A04E37",
      "primaryForeground": "#FFFFFF",
      "background": "#F4E5DE",
      "foreground": "#492C25",
      "card": "#FFF5F0",
      "cardForeground": "#492C25",
      "secondary": "#E8D8D1",
      "secondaryForeground": "#6F5852",
      "muted": "#E8D8D1",
      "mutedForeground": "#6F5852",
      "popover": "#FFF5F0",
      "popoverForeground": "#492C25",
      "border": "#CBB9B2",
      "input": "#CBB9B2",
      "ring": "#A04E37",
      "sidebar": "#663D32",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#744E43",
      "sidebarAccent": "#A04E37",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#89685D",
      "wmsAccent": "#A04E37",
      "videoPanelBackground": "#FFF5F0",
      "videoPanelText": "#492C25",
      "footerBackground": "#663D32",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#A04E37"
    }
  },
  {
    "id": "mist",
    "name": "Mist",
    "description": "Pale grey-blue",
    "group": "Modern",
    "swatch": "#4C7593",
    "dark": false,
    "colors": {
      "primary": "#4C7593",
      "primaryForeground": "#FFFFFF",
      "background": "#F0F4F7",
      "foreground": "#314657",
      "card": "#FFFFFF",
      "cardForeground": "#314657",
      "secondary": "#E3E8EC",
      "secondaryForeground": "#596873",
      "muted": "#E3E8EC",
      "mutedForeground": "#596873",
      "popover": "#FFFFFF",
      "popoverForeground": "#314657",
      "border": "#C2CAD1",
      "input": "#C2CAD1",
      "ring": "#4C7593",
      "sidebar": "#40576C",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#516678",
      "sidebarAccent": "#4C7593",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#6C7C8A",
      "wmsAccent": "#4C7593",
      "videoPanelBackground": "#FFFFFF",
      "videoPanelText": "#314657",
      "footerBackground": "#40576C",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#4C7593"
    }
  },
  {
    "id": "harbor",
    "name": "Harbor",
    "description": "Muted logistics blue-grey",
    "group": "Modern",
    "swatch": "#386D87",
    "dark": false,
    "colors": {
      "primary": "#386D87",
      "primaryForeground": "#FFFFFF",
      "background": "#E6EEF1",
      "foreground": "#294552",
      "card": "#F7FBFC",
      "cardForeground": "#294552",
      "secondary": "#D9E2E6",
      "secondaryForeground": "#52656F",
      "muted": "#D9E2E6",
      "mutedForeground": "#52656F",
      "popover": "#F7FBFC",
      "popoverForeground": "#294552",
      "border": "#B9C5CB",
      "input": "#B9C5CB",
      "ring": "#386D87",
      "sidebar": "#304D60",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#435C6D",
      "sidebarAccent": "#386D87",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#607581",
      "wmsAccent": "#386D87",
      "videoPanelBackground": "#F7FBFC",
      "videoPanelText": "#294552",
      "footerBackground": "#304D60",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#386D87"
    }
  },
  {
    "id": "moss",
    "name": "Moss",
    "description": "Natural green-grey",
    "group": "Modern",
    "swatch": "#56734C",
    "dark": false,
    "colors": {
      "primary": "#56734C",
      "primaryForeground": "#FFFFFF",
      "background": "#E8EDE4",
      "foreground": "#34442F",
      "card": "#F8FBF5",
      "cardForeground": "#34442F",
      "secondary": "#DBE1D7",
      "secondaryForeground": "#596456",
      "muted": "#DBE1D7",
      "mutedForeground": "#596456",
      "popover": "#F8FBF5",
      "popoverForeground": "#34442F",
      "border": "#BDC4B9",
      "input": "#BDC4B9",
      "ring": "#56734C",
      "sidebar": "#40503B",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#515F4B",
      "sidebarAccent": "#56734C",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#6C7764",
      "wmsAccent": "#56734C",
      "videoPanelBackground": "#F8FBF5",
      "videoPanelText": "#34442F",
      "footerBackground": "#40503B",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#56734C"
    }
  },
  {
    "id": "aviation",
    "name": "Aviation",
    "description": "Aircraft instrument panels",
    "group": "Industrial",
    "swatch": "#48D5DF",
    "dark": true,
    "colors": {
      "primary": "#48D5DF",
      "primaryForeground": "#111111",
      "background": "#101F2B",
      "foreground": "#E5F4FA",
      "card": "#203747",
      "cardForeground": "#E5F4FA",
      "secondary": "#1F2E39",
      "secondaryForeground": "#A9B8C0",
      "muted": "#1F2E39",
      "mutedForeground": "#A9B8C0",
      "popover": "#203747",
      "popoverForeground": "#E5F4FA",
      "border": "#43525D",
      "input": "#43525D",
      "ring": "#48D5DF",
      "sidebar": "#172B3B",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#2B3D4B",
      "sidebarAccent": "#48D5DF",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#4B5964",
      "wmsAccent": "#48D5DF",
      "videoPanelBackground": "#203747",
      "videoPanelText": "#E5F4FA",
      "footerBackground": "#172B3B",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#48D5DF"
    }
  },
  {
    "id": "expedition",
    "name": "Expedition",
    "description": "Industrial olive and sand",
    "group": "Industrial",
    "swatch": "#657342",
    "dark": false,
    "colors": {
      "primary": "#657342",
      "primaryForeground": "#FFFFFF",
      "background": "#ECE8DB",
      "foreground": "#303828",
      "card": "#FAF7ED",
      "cardForeground": "#303828",
      "secondary": "#DFDCCE",
      "secondaryForeground": "#5D6053",
      "muted": "#DFDCCE",
      "mutedForeground": "#5D6053",
      "popover": "#FAF7ED",
      "popoverForeground": "#303828",
      "border": "#BFBEB0",
      "input": "#BFBEB0",
      "ring": "#657342",
      "sidebar": "#353E2D",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#474F3E",
      "sidebarAccent": "#657342",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#63695A",
      "wmsAccent": "#657342",
      "videoPanelBackground": "#FAF7ED",
      "videoPanelText": "#303828",
      "footerBackground": "#353E2D",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#657342"
    }
  },
  {
    "id": "monaco",
    "name": "Monaco",
    "description": "Cream and burgundy",
    "group": "Premium",
    "swatch": "#8D304B",
    "dark": false,
    "colors": {
      "primary": "#8D304B",
      "primaryForeground": "#FFFFFF",
      "background": "#F8F3EE",
      "foreground": "#481C2B",
      "card": "#FFFFFF",
      "cardForeground": "#481C2B",
      "secondary": "#ECE4E0",
      "secondaryForeground": "#795862",
      "muted": "#ECE4E0",
      "mutedForeground": "#795862",
      "popover": "#FFFFFF",
      "popoverForeground": "#481C2B",
      "border": "#CEBFBF",
      "input": "#CEBFBF",
      "ring": "#8D304B",
      "sidebar": "#481C2B",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#58303D",
      "sidebarAccent": "#8D304B",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#724F58",
      "wmsAccent": "#8D304B",
      "videoPanelBackground": "#FFFFFF",
      "videoPanelText": "#481C2B",
      "footerBackground": "#481C2B",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#8D304B"
    }
  },
  {
    "id": "black-ice",
    "name": "Black Ice",
    "description": "Frosted dark silver and blue",
    "group": "Premium",
    "swatch": "#A5C8E5",
    "dark": true,
    "colors": {
      "primary": "#A5C8E5",
      "primaryForeground": "#111111",
      "background": "#141B24",
      "foreground": "#EDF5FF",
      "card": "#293747",
      "cardForeground": "#EDF5FF",
      "secondary": "#232A33",
      "secondaryForeground": "#B0B8C2",
      "muted": "#232A33",
      "mutedForeground": "#B0B8C2",
      "popover": "#293747",
      "popoverForeground": "#EDF5FF",
      "border": "#484F59",
      "input": "#484F59",
      "ring": "#A5C8E5",
      "sidebar": "#202B38",
      "sidebarForeground": "#F7F3ED",
      "sidebarCard": "#333D48",
      "sidebarAccent": "#A5C8E5",
      "sidebarAccentForeground": "#111111",
      "sidebarBorder": "#515962",
      "wmsAccent": "#A5C8E5",
      "videoPanelBackground": "#293747",
      "videoPanelText": "#EDF5FF",
      "footerBackground": "#202B38",
      "footerForeground": "#F7F3ED",
      "footerAccent": "#A5C8E5"
    }
  },
  {
    "id": "nordic",
    "name": "Nordic",
    "description": "Soft white and muted lavender",
    "group": "Modern",
    "swatch": "#716CB0",
    "dark": false,
    "colors": {
      "primary": "#716CB0",
      "primaryForeground": "#FFFFFF",
      "background": "#F3F4F8",
      "foreground": "#34394D",
      "card": "#FFFFFF",
      "cardForeground": "#34394D",
      "secondary": "#E6E7EC",
      "secondaryForeground": "#606472",
      "muted": "#E6E7EC",
      "mutedForeground": "#606472",
      "popover": "#FFFFFF",
      "popoverForeground": "#34394D",
      "border": "#C5C7CF",
      "input": "#C5C7CF",
      "ring": "#716CB0",
      "sidebar": "#454C65",
      "sidebarForeground": "#FFF9EF",
      "sidebarCard": "#565C71",
      "sidebarAccent": "#716CB0",
      "sidebarAccentForeground": "#FFFFFF",
      "sidebarBorder": "#707485",
      "wmsAccent": "#716CB0",
      "videoPanelBackground": "#FFFFFF",
      "videoPanelText": "#34394D",
      "footerBackground": "#454C65",
      "footerForeground": "#FFF9EF",
      "footerAccent": "#716CB0"
    }
  }
] as const;

export function materialTheme(id: string) {
  return MATERIAL_THEME_PRESETS.find((item) => item.id === id);
}

export const THEME_PRESETS = [
  { id: "garuda", name: "Current ORCA", description: "Original Garuda / Sentry appearance", swatch: "#8b1a2c", dark: false },
  { id: "ocean", name: "Ocean Blue", description: "Professional logistics blue", swatch: "#1e3a6e", dark: false },
  { id: "sky", name: "Azure Sky", description: "Bright corporate blue", swatch: "#2f7ed8", dark: false },
  { id: "emerald", name: "Emerald", description: "Operations green", swatch: "#12926f", dark: false },
  { id: "violet", name: "Royal Purple", description: "Modern purple", swatch: "#6d4bd8", dark: false },
  { id: "copper", name: "Copper Gold", description: "Industrial warm copper", swatch: "#8b5a2b", dark: false },
  { id: "graphite", name: "Minimal Graphite", description: "Neutral and distraction-free", swatch: "#4a4f57", dark: false },
  { id: "arctic", name: "Arctic Sky", description: "Cool teal and frost", swatch: "#2a8fa8", dark: false },
  { id: "midnight", name: "Midnight Blue", description: "Dark navy and blue", swatch: "#4a7fd8", dark: true },
  { id: "forest", name: "Dark Forest", description: "Dark green", swatch: "#22d870", dark: true },
  { id: "storm", name: "Charcoal", description: "Dark graphite and blue", swatch: "#3a6fd8", dark: true },
  { id: "neon", name: "Neon Terminal", description: "High-contrast dark green", swatch: "#39ff7a", dark: true },
  ...[
  {
    "id": "workspace",
    "name": "Workspace Blue",
    "description": "Bright modern portal",
    "swatch": "#159FE3",
    "dark": false
  },
  {
    "id": "glass",
    "name": "Video Glass",
    "description": "Frosted glass",
    "swatch": "#8CCFF0",
    "dark": false
  },
  {
    "id": "amber",
    "name": "Warm Amber",
    "description": "Warm energetic accent",
    "swatch": "#D38B1B",
    "dark": false
  },
  {
    "id": "rose",
    "name": "Signal Rose",
    "description": "High visibility",
    "swatch": "#D94F5C",
    "dark": false
  },
  {
    "id": "blaze",
    "name": "Blaze",
    "description": "Orange and blue tint",
    "swatch": "#E06820",
    "dark": false
  },
  {
    "id": "tangerine",
    "name": "Tangerine",
    "description": "Warm orange",
    "swatch": "#D96A25",
    "dark": false
  },
  {
    "id": "sakura",
    "name": "Sakura",
    "description": "Cherry blossom",
    "swatch": "#D95F8A",
    "dark": false
  },
  {
    "id": "terra",
    "name": "Terra",
    "description": "Earthy terracotta",
    "swatch": "#B05A30",
    "dark": false
  },
  {
    "id": "vintage",
    "name": "Vintage Press",
    "description": "Sepia newspaper",
    "swatch": "#7A4520",
    "dark": false
  },
  {
    "id": "paper",
    "name": "Paper",
    "description": "Clean parchment",
    "swatch": "#3A4A8A",
    "dark": false
  },
  {
    "id": "kraft",
    "name": "Kraft",
    "description": "Cardboard",
    "swatch": "#8B5E3C",
    "dark": false
  },
  {
    "id": "blueprint",
    "name": "Blueprint",
    "description": "Engineering paper",
    "swatch": "#1A3F6F",
    "dark": false
  },
  {
    "id": "linen",
    "name": "Linen",
    "description": "Natural linen",
    "swatch": "#7A3B2E",
    "dark": false
  },
  {
    "id": "chalkboard",
    "name": "Chalkboard",
    "description": "Warm white and forest green",
    "swatch": "#2D5A3D",
    "dark": false
  },
  {
    "id": "vellum",
    "name": "Vellum",
    "description": "Tracing paper and graphite",
    "swatch": "#4A4A5A",
    "dark": false
  },
  {
    "id": "cork",
    "name": "Cork",
    "description": "Cork board tan and teal",
    "swatch": "#1A6B6B",
    "dark": false
  }
],
  ...MATERIAL_THEME_PRESETS,
] as const;

export type ThemeModule = "erp" | "ltms" | "wms" | "hrms" | "accounts";
export type ThemeColors = Partial<Record<"primary" | "primaryForeground" | "background" | "foreground" | "card" | "cardForeground" | "secondary" | "secondaryForeground" | "muted" | "mutedForeground" | "popover" | "popoverForeground" | "border" | "input" | "ring" | "sidebar" | "sidebarForeground" | "sidebarCard" | "sidebarAccent" | "sidebarAccentForeground" | "sidebarBorder" | "wmsAccent" | "videoHeading" | "videoText" | "videoMutedText" | "videoLink" | "videoLabel" | "videoPanelBackground" | "videoPanelText" | "footerBackground" | "footerForeground" | "footerAccent", string>>;
export type ThemeProfile = {
  version: 2;
  baseTheme: string;
  modules: Partial<Record<ThemeModule, string>>;
  colors: ThemeColors;
  /** Explicit per-tab video choices; absent keys use the secure default policy. */
  videoTabs: Record<string, boolean>;
  /** Text contrast without blurring the underlying footage. */
  videoTextShadow: "none" | "subtle" | "strong";
  videoTextWeight: "regular" | "medium" | "bold";
  videoPlayback: {
    /** Workspace-wide default mode. Local Play/Pause overrides it per device. */
    backgroundMode: "video" | "still" | "blank";
    /** Universal effects apply to background media, never foreground text. */
    blur: number;
    tintColor: string;
    tintOpacity: number;
    brightness: number;
    saturation: number;
    contrast: number;
    grayscale: number;
    hueRotate: number;
    zoom: number;
    startPaused: boolean;
    playbackRate: number;
    pauseWhenHidden: boolean;
    respectReducedMotion: boolean;
    loopVideo: boolean;
    showPauseButton: boolean;
    videoDim: number;
  };
  density: "comfortable" | "compact";
  /** Home screen module icon glyph diameter, in CSS pixels. */
  homeIconSize: number;
  radius: number | null;
};

export const DEFAULT_THEME_PROFILE: ThemeProfile = {
  version: 2,
  baseTheme: "garuda",
  modules: {},
  colors: {},
  videoTabs: {},
  videoTextShadow: "subtle",
  videoTextWeight: "medium",
  videoPlayback: {
    backgroundMode: "video",
    blur: 0,
    tintColor: "#000000",
    tintOpacity: 0,
    brightness: 100,
    saturation: 100,
    contrast: 100,
    grayscale: 0,
    hueRotate: 0,
    zoom: 100,
    startPaused: false,
    playbackRate: 1,
    pauseWhenHidden: true,
    respectReducedMotion: true,
    loopVideo: true,
    showPauseButton: true,
    videoDim: 0,
  },
  density: "comfortable",
  homeIconSize: 28,
  radius: null,
};

const MODULES: ThemeModule[] = ["erp", "ltms", "wms", "hrms", "accounts"];
const COLOR_FIELDS = ["primary","primaryForeground","background","foreground","card","cardForeground","secondary","secondaryForeground","muted","mutedForeground","popover","popoverForeground","border","input","ring","sidebar","sidebarForeground","sidebarCard","sidebarAccent","sidebarAccentForeground","sidebarBorder","wmsAccent","videoHeading","videoText","videoMutedText","videoLink","videoLabel","videoPanelBackground","videoPanelText","footerBackground","footerForeground","footerAccent"] as const;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DARK_THEME_IDS = new Set<string>(THEME_PRESETS.filter((item) => item.dark).map((item) => item.id));

export function isDarkTheme(themeId: string): boolean {
  return DARK_THEME_IDS.has(themeId);
}

export function normalizeThemeProfile(raw: unknown, allowed: ReadonlySet<string>): ThemeProfile {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const baseTheme = typeof source.baseTheme === "string" && allowed.has(source.baseTheme)
    ? source.baseTheme
    : "garuda";
  const rawModules = source.modules && typeof source.modules === "object"
    ? source.modules as Record<string, unknown> : {};
  const modules: ThemeProfile["modules"] = {};
  for (const module of MODULES) {
    const value = rawModules[module];
    if (typeof value === "string" && allowed.has(value)) modules[module] = value;
  }
  const rawColors = source.colors && typeof source.colors === "object"
    ? source.colors as Record<string, unknown> : {};
  const colors: ThemeColors = {};
  for (const key of COLOR_FIELDS) {
    const value = rawColors[key];
    if (typeof value === "string" && HEX_COLOR.test(value)) colors[key] = value;
  }
  const rawVideoTabs = source.videoTabs && typeof source.videoTabs === "object" && !Array.isArray(source.videoTabs)
    ? source.videoTabs as Record<string, unknown> : {};
  const videoTabs: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(rawVideoTabs).slice(0, 200)) {
    if (/^[a-z0-9:/_-]{1,96}$/.test(key) && typeof value === "boolean") videoTabs[key] = value;
  }
  const sourcePlayback = source.videoPlayback && typeof source.videoPlayback === "object"
    ? source.videoPlayback as Record<string, unknown> : {};
  const rate = typeof sourcePlayback.playbackRate === "number" && Number.isFinite(sourcePlayback.playbackRate)
    ? sourcePlayback.playbackRate : 1;
  const dim = typeof sourcePlayback.videoDim === "number" && Number.isFinite(sourcePlayback.videoDim)
    ? sourcePlayback.videoDim : 0;
  const bounded = (key: string, fallback: number, min: number, max: number) => {
    const raw = sourcePlayback[key];
    return typeof raw === "number" && Number.isFinite(raw)
      ? Math.max(min, Math.min(max, Math.round(raw))) : fallback;
  };
  return {
    version: 2,
    baseTheme,
    modules,
    colors,
    videoTabs,
    videoTextShadow: source.videoTextShadow === "none" || source.videoTextShadow === "strong"
      ? source.videoTextShadow : "subtle",
    videoTextWeight: source.videoTextWeight === "regular" || source.videoTextWeight === "bold"
      ? source.videoTextWeight : "medium",
    videoPlayback: {
      backgroundMode: sourcePlayback.backgroundMode === "still" || sourcePlayback.backgroundMode === "blank"
        ? sourcePlayback.backgroundMode
        : sourcePlayback.backgroundMode === "video" ? "video"
        : sourcePlayback.startPaused === true ? "still" : "video",
      blur: bounded("blur", 0, 0, 24),
      tintColor: typeof sourcePlayback.tintColor === "string" && HEX_COLOR.test(sourcePlayback.tintColor)
        ? sourcePlayback.tintColor : "#000000",
      tintOpacity: bounded("tintOpacity", 0, 0, 80),
      brightness: bounded("brightness", 100, 40, 160),
      saturation: bounded("saturation", 100, 0, 200),
      contrast: bounded("contrast", 100, 50, 160),
      grayscale: bounded("grayscale", 0, 0, 100),
      hueRotate: bounded("hueRotate", 0, -180, 180),
      zoom: bounded("zoom", 100, 100, 130),
      startPaused: sourcePlayback.startPaused === true,
      playbackRate: Math.max(0.5, Math.min(2, Math.round(rate * 4) / 4)),
      pauseWhenHidden: sourcePlayback.pauseWhenHidden !== false,
      respectReducedMotion: sourcePlayback.respectReducedMotion !== false,
      loopVideo: sourcePlayback.loopVideo !== false,
      showPauseButton: sourcePlayback.showPauseButton !== false,
      videoDim: Math.max(0, Math.min(15, Math.round(dim))),
    },
    density: source.density === "compact" ? "compact" : "comfortable",
    homeIconSize: typeof source.homeIconSize === "number" && Number.isFinite(source.homeIconSize)
      ? Math.max(16, Math.min(64, Math.round(source.homeIconSize)))
      : 28,
    radius: typeof source.radius === "number" && Number.isFinite(source.radius)
      ? Math.max(0, Math.min(24, source.radius))
      : null,
  };
}

export function parseThemeProfile(raw: unknown, allowed: ReadonlySet<string>): ThemeProfile {
  if (typeof raw !== "string") return { ...DEFAULT_THEME_PROFILE };
  if (allowed.has(raw)) return { ...DEFAULT_THEME_PROFILE, baseTheme: raw };
  if (!raw.startsWith(THEME_PROFILE_PREFIX) || raw.length > 32000) {
    return { ...DEFAULT_THEME_PROFILE };
  }
  try {
    return normalizeThemeProfile(JSON.parse(raw.slice(THEME_PROFILE_PREFIX.length)), allowed);
  } catch {
    return { ...DEFAULT_THEME_PROFILE };
  }
}

export function serializeThemeProfile(profile: ThemeProfile): string {
  if (Object.keys(profile.modules).length === 0 &&
      Object.keys(profile.colors).length === 0 &&
      Object.keys(profile.videoTabs ?? {}).length === 0 &&
      (profile.videoTextShadow ?? "subtle") === "subtle" &&
      (profile.videoTextWeight ?? "medium") === "medium" &&
      (!profile.videoPlayback || (
        profile.videoPlayback.startPaused !== true &&
        (profile.videoPlayback.backgroundMode ?? "video") === "video" &&
        (profile.videoPlayback.blur ?? 0) === 0 &&
        (profile.videoPlayback.tintColor ?? "#000000").toLowerCase() === "#000000" &&
        (profile.videoPlayback.tintOpacity ?? 0) === 0 &&
        (profile.videoPlayback.brightness ?? 100) === 100 &&
        (profile.videoPlayback.saturation ?? 100) === 100 &&
        (profile.videoPlayback.contrast ?? 100) === 100 &&
        (profile.videoPlayback.grayscale ?? 0) === 0 &&
        (profile.videoPlayback.hueRotate ?? 0) === 0 &&
        (profile.videoPlayback.zoom ?? 100) === 100 &&
        (profile.videoPlayback.playbackRate ?? 1) === 1 &&
        profile.videoPlayback.pauseWhenHidden !== false &&
        profile.videoPlayback.respectReducedMotion !== false &&
        profile.videoPlayback.loopVideo !== false &&
        profile.videoPlayback.showPauseButton !== false &&
        (profile.videoPlayback.videoDim ?? 0) === 0
      )) &&
      profile.density === "comfortable" && (profile.homeIconSize ?? 28) === 28 && profile.radius === null) {
    // Preserve compatibility with previous versions when no v2 customization is used.
    return profile.baseTheme;
  }
  return THEME_PROFILE_PREFIX + JSON.stringify(profile);
}

/** Resolve the visual module from real router paths. LTMS has several legacy
 * top-level routes, so checking only /ltms leaves most sidebars unthemed. */
export function themeModuleForPath(pathname: string): ThemeModule {
  const segment = pathname.toLowerCase().split("/")[1] ?? "";
  if (segment === "wms") return "wms";
  if (["accounts", "cash-reports"].includes(segment)) return "accounts";
  if (["hrms", "hr-dashboard", "hr-data", "dashboard", "employees", "payroll", "attendance"].includes(segment)) return "hrms";
  if (["ltms", "tms", "masters", "operations", "finance", "reports", "report-master", "import-trips"].includes(segment)) return "ltms";
  return "erp";
}

export function getModuleTheme(profile: ThemeProfile, module: ThemeModule): string {
  return profile.modules[module] || profile.baseTheme;
}

/** CSS custom-property map; includes both Tailwind semantic tokens and legacy Sentry/LTMS chrome. */
const COLOR_TOKENS: Record<keyof ThemeColors, readonly string[]> = {
  primary: ["--primary", "--primary-soft", "--primary-glow"],
  primaryForeground: ["--primary-foreground"],
  background: ["--background", "--ltms-surface"],
  foreground: ["--foreground", "--ltms-content-text"],
  card: ["--card", "--popover"],
  cardForeground: ["--card-foreground"],
  secondary: ["--secondary"],
  secondaryForeground: ["--secondary-foreground"],
  muted: ["--muted"],
  mutedForeground: ["--muted-foreground"],
  popover: ["--popover"],
  popoverForeground: ["--popover-foreground"],
  border: ["--border"],
  input: ["--input"],
  ring: ["--ring"],
  sidebar: ["--sidebar", "--ltms-chrome", "--wms-chrome"],
  sidebarForeground: ["--sidebar-foreground", "--ltms-chrome-text", "--wms-chrome-text"],
  sidebarCard: ["--ltms-chrome-card", "--wms-chrome-card"],
  sidebarAccent: ["--sidebar-accent", "--ltms-chrome-accent", "--wms-copper", "--ltms-branded"],
  sidebarAccentForeground: ["--sidebar-accent-foreground"],
  sidebarBorder: ["--sidebar-border"],
  wmsAccent: ["--wms-accent-override"],
  videoHeading: ["--video-heading"],
  videoText: ["--video-text"],
  videoMutedText: ["--video-muted-text"],
  videoLink: ["--video-link"],
  videoLabel: ["--video-label"],
  videoPanelBackground: ["--video-panel-background"],
  videoPanelText: ["--video-panel-text"],
  footerBackground: ["--theme-footer-bg"],
  footerForeground: ["--theme-footer-text"],
  footerAccent: ["--theme-footer-border"],
};
const ROOT_OVERRIDES = [...new Set(Object.values(COLOR_TOKENS).flat().concat([
  "--sidebar-primary", "--sidebar-primary-foreground",
]))];

export function themeInlineStyles(profile: ThemeProfile): Record<string, string> {
  const result: Record<string, string> = {};
  const colors = profile.colors;
  for (const [key, value] of Object.entries(colors)) {
    if (typeof value !== "string" || !HEX_COLOR.test(value)) continue;
    for (const token of COLOR_TOKENS[key as keyof ThemeColors] ?? []) {
      if (token === "--primary-soft") result[token] = `color-mix(in oklch, ${value} 14%, var(--card))`;
      else if (token === "--primary-glow") result[token] = `color-mix(in oklch, ${value} 65%, white)`;
      else result[token] = value;
    }
  }
  if (colors.primary && !colors.ring) result["--ring"] = colors.primary;
  if (colors.primary && !colors.sidebarAccent) result["--sidebar-primary"] = colors.primary;
  if (colors.primaryForeground && !colors.sidebarAccentForeground) {
    result["--sidebar-primary-foreground"] = colors.primaryForeground;
  }
  if (colors.foreground && !colors.cardForeground) result["--card-foreground"] = colors.foreground;
  if (colors.foreground && !colors.popoverForeground) result["--popover-foreground"] = colors.foreground;
  if (colors.border && !colors.input) result["--input"] = colors.border;
  result["--video-text-shadow"] = profile.videoTextShadow === "none" ? "none"
    : profile.videoTextShadow === "strong"
      ? "0 2px 4px rgb(0 0 0 / 0.92), 0 0 10px rgb(0 0 0 / 0.56)"
      : "0 1px 3px rgb(0 0 0 / 0.82)";
  result["--video-dim-opacity"] = String(Math.min(0.15, Math.max(0, (profile.videoPlayback?.videoDim ?? 0) / 100)));
  result["--video-text-weight"] = profile.videoTextWeight === "bold" ? "700"
    : profile.videoTextWeight === "regular" ? "400" : "500";
  if (profile.radius !== null) result["--radius"] = profile.radius + "px";
  return result;
}

/**
 * A module can use a light theme while the workspace default is dark (and
 * vice versa). Light accent-only presets do not reset surface tokens on their
 * own, so give an explicitly overridden module a complete readable baseline.
 * User-chosen custom colours always win.
 */
const MODULE_LIGHT_SURFACES: Record<string, string> = {
  "--background": "#fafaf7",
  "--foreground": "#1a1714",
  "--card": "#ffffff",
  "--card-foreground": "#1a1714",
  "--popover": "#ffffff",
  "--popover-foreground": "#1a1714",
  "--secondary": "#f2f3f5",
  "--secondary-foreground": "#263443",
  "--muted": "#f5f3ee",
  "--muted-foreground": "#6b5f50",
  "--border": "#e8e2d8",
  "--input": "#e8e2d8",
  "--sidebar": "#2a2520",
  "--sidebar-foreground": "#fdf4e3",
  "--sidebar-border": "#554b40",
};
const MODULE_DARK_SURFACES: Record<string, string> = {
  "--background": "#121821",
  "--foreground": "#f1f5f9",
  "--card": "#202a36",
  "--card-foreground": "#f1f5f9",
  "--popover": "#202a36",
  "--popover-foreground": "#f1f5f9",
  "--secondary": "#293444",
  "--secondary-foreground": "#eef2fa",
  "--muted": "#28313e",
  "--muted-foreground": "#afbdcb",
  "--border": "#3c4b5c",
  "--input": "#3c4b5c",
  "--sidebar": "#172130",
  "--sidebar-foreground": "#f1f5f9",
  "--sidebar-border": "#415066",
};

export function moduleThemeInlineStyles(profile: ThemeProfile, module: ThemeModule): Record<string, string> {
  const moduleTheme = getModuleTheme(profile, module);
  return {
    ...(moduleTheme === profile.baseTheme || materialTheme(moduleTheme)
      ? {}
      : isDarkTheme(moduleTheme) ? MODULE_DARK_SURFACES : MODULE_LIGHT_SURFACES),
    ...themeInlineStyles(profile),
  };
}

export function applyThemeProfile(profile: ThemeProfile): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.density = profile.density;
  const routeTheme = typeof window === "undefined" ? profile.baseTheme :
    getModuleTheme(profile, themeModuleForPath(window.location.pathname));
  root.dataset.theme = routeTheme;
  root.classList.toggle("dark", isDarkTheme(routeTheme));
  for (const name of ROOT_OVERRIDES) root.style.removeProperty(name);
  root.style.removeProperty("--radius");
  for (const [key, value] of Object.entries(themeInlineStyles(profile))) root.style.setProperty(key, value);
}
