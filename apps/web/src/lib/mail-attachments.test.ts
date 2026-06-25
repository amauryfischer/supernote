import { describe, it, expect } from "vitest";
import {
  totalAttachmentsSize,
  exceedsAttachmentLimit,
  attachmentLabel,
  dataUrlToBase64,
  toOutgoing,
  MAX_ATTACHMENTS_BYTES,
  type PendingAttachment,
} from "./mail-attachments";

const att = (over: Partial<PendingAttachment> = {}): PendingAttachment => ({
  filename: "f.txt",
  mimeType: "text/plain",
  base64: "AAA=",
  size: 10,
  ...over,
});

describe("totalAttachmentsSize", () => {
  it("somme les tailles", () => {
    expect(totalAttachmentsSize([att({ size: 10 }), att({ size: 5 })])).toBe(15);
  });
  it("ignore les tailles non finies", () => {
    expect(totalAttachmentsSize([att({ size: 10 }), att({ size: NaN })])).toBe(10);
  });
  it("vide → 0", () => {
    expect(totalAttachmentsSize([])).toBe(0);
  });
});

describe("exceedsAttachmentLimit", () => {
  it("faux sous 25 Mo", () => {
    expect(exceedsAttachmentLimit([att({ size: 1024 })])).toBe(false);
  });
  it("vrai au-delà de 25 Mo", () => {
    expect(exceedsAttachmentLimit([att({ size: MAX_ATTACHMENTS_BYTES + 1 })])).toBe(true);
  });
  it("limite exacte n'est pas dépassée", () => {
    expect(exceedsAttachmentLimit([att({ size: MAX_ATTACHMENTS_BYTES })])).toBe(false);
  });
});

describe("attachmentLabel", () => {
  it("formate nom · taille", () => {
    expect(attachmentLabel({ filename: "doc.pdf", size: 2048 })).toBe("doc.pdf · 2 Ko");
  });
});

describe("dataUrlToBase64", () => {
  it("isole le payload base64 d'un data-URL", () => {
    expect(dataUrlToBase64("data:text/plain;base64,SGVsbG8=")).toBe("SGVsbG8=");
  });
  it("data-URL avec charset avant base64", () => {
    expect(dataUrlToBase64("data:text/plain;charset=utf-8;base64,QUJD")).toBe("QUJD");
  });
  it("chaîne sans virgule → inchangée", () => {
    expect(dataUrlToBase64("SGVsbG8=")).toBe("SGVsbG8=");
  });
  it("data-URL non base64 → renvoie la chaîne brute (cas dégradé)", () => {
    expect(dataUrlToBase64("data:text/plain,Hello")).toBe("data:text/plain,Hello");
  });
});

describe("toOutgoing", () => {
  it("retire le champ size (forme OutgoingAttachment)", () => {
    const out = toOutgoing([att({ size: 99 })]);
    expect(out).toEqual([{ filename: "f.txt", mimeType: "text/plain", base64: "AAA=" }]);
    expect(out[0]).not.toHaveProperty("size");
  });
});
