/**
 * Kartu Coming Soon (docs/spec.md bagian 1). HANYA kartu: tidak ada logika game.
 * Teks diambil apa adanya dari tabel di spec.
 */
export const COMING_SOON = [
  { name: "High Card", text: "Draw one card each, highest card wins" },
  { name: "Battle Royale", text: "2–10 players, random elimination, last one standing takes the pot" },
  { name: "Mines Duel", text: "Pick your tiles, dodge the mines, outlast your rival" },
  { name: "Memecoin Jackpot", text: "Pool your tokens, one winner takes all" },
  { name: "Stock Price Arena", text: "Call the next move of tokenized stocks" },
  { name: "Casino", text: "Classic casino games" },
  { name: "Referral", text: "Earn a share of fees from friends you invite" },
] as const;
