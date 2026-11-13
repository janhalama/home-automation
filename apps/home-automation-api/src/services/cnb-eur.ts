/*
The Czech National Bank euro fixing.
A day with no new fixing keeps the previous one, which is how weekends are priced.
*/

export type CnbEurRate = {
  date: string;
  czkPerEur: number;
};

export type CnbResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

const CNB_EUR_URL = "https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/selected.txt";

/* ISO date to the DD.MM.YYYY form ČNB expects. */
function cnbDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

/* DD.MM.YYYY to an ISO date. */
function isoDate(cnb: string): string {
  const [day, month, year] = cnb.split(".");
  return `${year}-${month}-${day}`;
}

/* Turn the selected-rate text into one row per published day. */
export function parseCnbEurRates(text: string): CnbEurRate[] {
  const amountLine = text.split("\n").find((line) => line.startsWith("Currency:"));
  const amount = Number(amountLine?.split("Amount:")[1] ?? "1");
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("The ČNB amount is missing");
  return text.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d{2}\.\d{2}\.\d{4})\|(\d+(?:\.\d+)?)$/);
    if (!match)
      return [];
    return [{ date: isoDate(match[1]), czkPerEur: Number(match[2]) / amount }];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

/* The fixing in force on this date. Days before the first row have none. */
export function czkPerEurOn(date: string, rates: CnbEurRate[]): number | null {
  let rate: number | null = null;
  for (const row of rates) {
    if (row.date > date)
      break;
    rate = row.czkPerEur;
  }
  return rate;
}

/* Read the euro fixing published between two dates, inclusive. */
export async function fetchCnbEurRates(
  from: string,
  to: string,
  fetchImpl: (url: string) => Promise<CnbResponse>
): Promise<CnbEurRate[]> {
  const url = `${CNB_EUR_URL}?from=${cnbDate(from)}&to=${cnbDate(to)}&currency=EUR`;
  const response = await fetchImpl(url);
  if (!response.ok)
    throw new Error(`ČNB responded ${response.status}`);
  return parseCnbEurRates(await response.text());
}
