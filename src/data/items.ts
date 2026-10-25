/**
 * Item database (MapleStory Classic). Used by upcoming features (e.g. showing
 * item cost/effects). Pure data - no I/O - so it bundles with the static site.
 *
 * Extend this as more items are catalogued. Food items are added next.
 *
 * `mesoCost` is the NPC/market cost in meso, or null when not yet recorded.
 * Effects: flat values are absolute HP/MP restored; percent values restore that
 * percentage of max HP/MP.
 */

export type ItemCategory = "potion" | "food";

export interface ItemEffect {
  /** Flat HP restored. */
  hpFlat?: number;
  /** Flat MP restored. */
  mpFlat?: number;
  /** Percent of max HP restored. */
  hpPercent?: number;
  /** Percent of max MP restored. */
  mpPercent?: number;
}

export interface Item {
  /** Stable kebab-case identifier. */
  id: string;
  /** Display name. */
  name: string;
  category: ItemCategory;
  effect: ItemEffect;
  /** Cost in meso, or null if unknown / not yet recorded. */
  mesoCost: number | null;
}

/** Recovery potions. */
export const POTIONS: readonly Item[] = [
  {
    id: "red-potion",
    name: "Red Potion",
    category: "potion",
    effect: { hpFlat: 100 },
    mesoCost: 50,
  },
  {
    id: "orange-potion",
    name: "Orange Potion",
    category: "potion",
    effect: { hpFlat: 250 },
    mesoCost: 150,
  },
  {
    id: "white-potion",
    name: "White Potion",
    category: "potion",
    effect: { hpFlat: 500 },
    mesoCost: 350,
  },
  {
    id: "blue-potion",
    name: "Blue Potion",
    category: "potion",
    effect: { mpFlat: 200 },
    mesoCost: 220,
  },
  {
    id: "elixir",
    name: "Elixir",
    category: "potion",
    effect: { hpPercent: 35, mpPercent: 35 },
    mesoCost: 3000,
  },
  {
    id: "power-elixir",
    name: "Power Elixir",
    category: "potion",
    effect: { hpPercent: 100, mpPercent: 100 },
    mesoCost: null, // not yet recorded
  },
  {
    id: "mana-elixir",
    name: "Mana Elixir",
    category: "potion",
    effect: { mpPercent: 50 },
    mesoCost: null, // not yet recorded
  },
];

/** Food items. */
export const FOOD: readonly Item[] = [
  { id: "apple", name: "Apple", category: "food", effect: { hpFlat: 40 }, mesoCost: 20 },
  { id: "egg", name: "Egg", category: "food", effect: { hpFlat: 60 }, mesoCost: 30 },
  { id: "meat", name: "Meat", category: "food", effect: { hpFlat: 160 }, mesoCost: 80 },
  { id: "orange", name: "Orange", category: "food", effect: { mpFlat: 50 }, mesoCost: 50 },
  { id: "lemon", name: "Lemon", category: "food", effect: { mpFlat: 150 }, mesoCost: 150 },
  {
    id: "watermelon",
    name: "Watermelon",
    category: "food",
    effect: { hpFlat: 800, mpFlat: 800 },
    mesoCost: 1920,
  },
  { id: "salad", name: "Salad", category: "food", effect: { mpFlat: 200 }, mesoCost: 220 },
  {
    id: "fried-chicken",
    name: "Fried Chicken",
    category: "food",
    effect: { hpFlat: 120 },
    mesoCost: 60,
  },
  {
    id: "cake",
    name: "Cake",
    category: "food",
    effect: { hpFlat: 100, mpFlat: 100 },
    mesoCost: 150,
  },
  { id: "pizza", name: "Pizza", category: "food", effect: { hpFlat: 360 }, mesoCost: 252 },
  {
    id: "hamburger",
    name: "Hamburger",
    category: "food",
    effect: { hpFlat: 500 },
    mesoCost: 350,
  },
  { id: "hot-dog", name: "Hot Dog", category: "food", effect: { hpFlat: 300 }, mesoCost: 180 },
  {
    id: "hot-dog-supreme",
    name: "Hot Dog Supreme",
    category: "food",
    effect: { hpFlat: 600 },
    mesoCost: 480,
  },
  {
    id: "dried-squid",
    name: "Dried Squid",
    category: "food",
    effect: { hpFlat: 300 },
    mesoCost: 180,
  },
  {
    id: "fat-sausage",
    name: "Fat Sausage",
    category: "food",
    effect: { hpFlat: 800 },
    mesoCost: 800,
  },
  {
    id: "orange-juice",
    name: "Orange Juice",
    category: "food",
    effect: { mpFlat: 450 },
    mesoCost: 540,
  },
  {
    id: "grape-juice",
    name: "Grape Juice",
    category: "food",
    effect: { mpFlat: 900 },
    mesoCost: 1260,
  },
  {
    id: "w-ramen",
    name: "W Ramen",
    category: "food",
    effect: { hpPercent: 40, mpPercent: 40 },
    mesoCost: 1500,
  },
  {
    id: "ice-cream-pop",
    name: "Ice Cream Pop",
    category: "food",
    effect: { hpFlat: 1500 },
    mesoCost: null, // not provided
  },
];

/** All items across every category. */
export const ITEMS: readonly Item[] = [...POTIONS, ...FOOD];

/** Look up an item by its id. */
export function itemById(id: string): Item | undefined {
  return ITEMS.find((item) => item.id === id);
}

/** All items in a given category. */
export function itemsByCategory(category: ItemCategory): Item[] {
  return ITEMS.filter((item) => item.category === category);
}
