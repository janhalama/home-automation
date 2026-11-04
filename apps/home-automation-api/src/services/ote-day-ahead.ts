/*
Reads the Czech day-ahead prices from OTE's public service.
Each period is the marginal price in EUR/MWh. Kč/kWh is derived with the rate that matches Loxone.
*/

export type SpotPrice = {
  date: string;
  periodIndex: number;
  periodInterval: string;
  eurPerMwh: number;
};

const OTE_URL = "https://www.ote-cr.cz/services/PublicDataService";
const SOAP_ACTION = "http://www.ote-cr.cz/schema/service/public/GetDamPricePeriodE";

export type OteResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
};

export type OtePost = (
  url: string,
  body: string,
  headers: Record<string, string>
) => Promise<OteResponse>;

/* Read one XML element. Missing elements return null. */
function elementText(item: string, name: string): string | null {
  const match = item.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return match ? match[1] : null;
}

/* Turn one OTE day-ahead response into period prices. A period with no price is an emergency interval. */
export function parseDayAheadPrices(xml: string): SpotPrice[] {
  const items = xml.match(/<Item>[\s\S]*?<\/Item>/g) ?? [];
  const prices: SpotPrice[] = [];
  for (const item of items) {
    const priceText = elementText(item, "Price");
    if (priceText === null)
      continue;
    const date = elementText(item, "Date");
    const periodIndex = elementText(item, "PeriodIndex");
    const periodInterval = elementText(item, "PeriodInterval");
    if (!date || !periodIndex || !periodInterval)
      throw new Error("OTE price item is missing a field");
    const eurPerMwh = Number(priceText);
    if (!Number.isFinite(eurPerMwh))
      throw new Error("OTE price is not a number");
    prices.push({
      date,
      periodIndex: Number(periodIndex),
      periodInterval,
      eurPerMwh
    });
  }
  if (prices.length === 0)
    throw new Error("OTE response contained no prices");
  return prices;
}

/* Build the SOAP body for one delivery day at 15-minute resolution. */
export function dayAheadRequestXml(date: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pub="http://www.ote-cr.cz/schema/service/public">
  <soapenv:Body>
    <pub:GetDamPricePeriodE>
      <pub:StartDate>${date}</pub:StartDate>
      <pub:EndDate>${date}</pub:EndDate>
      <pub:PeriodResolution>PT15M</pub:PeriodResolution>
    </pub:GetDamPricePeriodE>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/* Download one delivery day. */
export async function fetchDayAheadPrices(date: string, post: OtePost): Promise<SpotPrice[]> {
  const response = await post(OTE_URL, dayAheadRequestXml(date), {
    "Content-Type": "text/xml; charset=utf-8",
    SOAPAction: SOAP_ACTION
  });
  if (!response.ok)
    throw new Error(`OTE responded ${response.status}`);
  return parseDayAheadPrices(await response.text());
}

/* Convert a marginal price to Kč/kWh. One EUR/MWh is czkPerEur/1000 Kč/kWh. */
export function czkPerKwh(eurPerMwh: number, czkPerEur: number): number {
  return (eurPerMwh * czkPerEur) / 1000;
}

/* Record the Kč per EUR that makes this OTE interval match the price Loxone is showing. */
export function czkPerEurMatchingLoxone(eurPerMwh: number, loxoneCzkPerKwh: number): number {
  if (eurPerMwh === 0)
    throw new Error("OTE price is zero");
  return (loxoneCzkPerKwh * 1000) / eurPerMwh;
}
