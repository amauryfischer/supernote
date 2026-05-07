// Minimal vCard 3.0/4.0 parser (no external dep required)

export interface VCardProp {
  readonly name: string;
  readonly params: Record<string, string>;
  readonly value: string;
}

export interface VCard {
  readonly props: VCardProp[];
}

/** Unfold vCard lines (RFC 6350 section 3.2) */
function unfoldLines(content: string): string {
  return content.replace(/\r?\n[ \t]/g, "");
}

/** Parse a single property line like "TEL;TYPE=CELL:+33612345678" */
function parsePropLine(line: string): VCardProp | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;

  const namePart = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1).trim();

  const segments = namePart.split(";");
  const name = (segments[0] ?? "").toUpperCase();
  const params: Record<string, string> = {};

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i] ?? "";
    const eqIdx = seg.indexOf("=");
    if (eqIdx !== -1) {
      params[seg.slice(0, eqIdx).toUpperCase()] = seg.slice(eqIdx + 1);
    } else {
      params[seg.toUpperCase()] = "true";
    }
  }

  return { name, params, value };
}

/** Split raw .vcf content into individual vCard blocks */
function splitVCards(content: string): string[] {
  const unfolded = unfoldLines(content);
  const blocks: string[] = [];
  let current: string[] = [];
  let inCard = false;

  for (const line of unfolded.split(/\r?\n/)) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      inCard = true;
      current = [line];
    } else if (upper === "END:VCARD") {
      current.push(line);
      blocks.push(current.join("\n"));
      current = [];
      inCard = false;
    } else if (inCard) {
      current.push(line);
    }
  }

  return blocks;
}

/** Parse a vCard block into structured VCard */
function parseVCard(block: string): VCard {
  const props: VCardProp[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.toUpperCase() === "BEGIN:VCARD" || line.toUpperCase() === "END:VCARD") {
      continue;
    }
    const prop = parsePropLine(line);
    if (prop && prop.name) props.push(prop);
  }

  return { props };
}

/** Get all values for a given property name */
export function getProps(vcard: VCard, name: string): VCardProp[] {
  return vcard.props.filter((p) => p.name === name.toUpperCase());
}

/** Get the first value for a property name, or undefined */
export function getProp(vcard: VCard, name: string): string | undefined {
  return vcard.props.find((p) => p.name === name.toUpperCase())?.value;
}

/** Parse a full .vcf file and return all vCards */
export function parseVcfFile(content: string): VCard[] {
  return splitVCards(content).map(parseVCard);
}

/** Decode quoted-printable encoding */
export function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, "") // soft line breaks
    .replace(/=[0-9A-Fa-f]{2}/g, (m) => String.fromCharCode(parseInt(m.slice(1), 16)));
}

/** Normalize a vCard value, handling ENCODING param */
export function normalizeValue(prop: VCardProp): string {
  const enc = prop.params["ENCODING"]?.toUpperCase();
  if (enc === "QUOTED-PRINTABLE") return decodeQuotedPrintable(prop.value);
  return prop.value;
}
