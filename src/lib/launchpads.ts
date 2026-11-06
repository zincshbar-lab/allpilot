// Known NEAR token factories / launchpads, matched by the token account's parent.
// `native` = Allpilot can launch and trade on it directly (via its Rhea DCL pools).

export type LaunchpadInfo = { name: string; site?: string; native?: boolean };

const FACTORIES: [suffix: string, info: LaunchpadInfo][] = [
  ["v2-launchpad.justhoot.near", { name: "JustHoot (v2)", site: "https://justhoot.fun", native: true }],
  ["launchpad.justhoot.near", { name: "JustHoot (v1)", site: "https://justhoot.fun", native: true }],
  ["nearlytrade.near", { name: "nearly.trade", site: "https://nearly.trade", native: true }],
  ["meme-cooking.near", { name: "meme.cooking", site: "https://meme.cooking" }],
  ["rhea.meme-launchpad.near", { name: "Rhea meme launchpad", site: "https://app.rhea.finance" }],
  ["tkn.near", { name: "tkn.near token factory" }],
  ["tknx.near", { name: "tknx token factory" }],
  ["tknport.near", { name: "tknport token factory" }],
  ["token0.near", { name: "token0 factory" }],
  ["nearpadfamily.near", { name: "NearPad" }],
  ["launch.shoremarkets.near", { name: "Shore Markets" }],
  ["nearafun.near", { name: "nearafun" }],
  ["prismpad.near", { name: "PrismPad" }],
  ["nearpaid.near", { name: "NearPaid" }],
  ["aidols.near", { name: "aidols" }],
  ["cookinglabs.near", { name: "Cooking Labs" }],
  ["nearbased.near", { name: "nearbased" }],
  ["nearrr-fun.near", { name: "nearrr.fun" }],
  ["pad.terminalpad.near", { name: "TerminalPad" }],
  ["pad.onetokenhub.near", { name: "OneTokenHub" }],
  ["gra-fun.near", { name: "gra.fun" }],
  ["smithii.near", { name: "Smithii" }],
  ["factory.bridge.near", { name: "Rainbow Bridge (bridged ERC-20)" }],
  ["omft.near", { name: "NEAR Intents bridged token (OMFT)" }],
  ["omdep.near", { name: "NEAR Intents bridged token" }],
];

export function launchpadOfToken(tokenId: string): (LaunchpadInfo & { factory: string }) | null {
  for (const [suffix, info] of FACTORIES) if (tokenId.endsWith(`.${suffix}`)) return { ...info, factory: suffix };
  return null;
}

export function launchpadName(tokenId: string): string | null {
  const l = launchpadOfToken(tokenId);
  if (!l || /bridge|OMFT|Intents/.test(l.name)) return null; // bridged assets aren't memes
  return l.name;
}

/** Parent account (e.g. "x.factory.near" → "factory.near"); top-level accounts have none. */
export const parentOf = (id: string) => (id.includes(".") ? id.slice(id.indexOf(".") + 1) : null);
