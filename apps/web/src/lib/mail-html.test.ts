// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeEmailHtml, splitQuotedHtml } from "./mail-html";

describe("splitQuotedHtml", () => {
  it("sépare un conteneur gmail_quote", () => {
    const html = `<div>Bonjour</div><div class="gmail_quote"><div>On Thu wrote:</div><blockquote>ancien</blockquote></div>`;
    const { body, quoted } = splitQuotedHtml(html);
    expect(body).toContain("Bonjour");
    expect(body).not.toContain("ancien");
    expect(quoted).toContain("ancien");
  });

  it("sépare un blockquote final", () => {
    const { body, quoted } = splitQuotedHtml("<p>Nouveau</p><blockquote>cité</blockquote>");
    expect(body).toContain("Nouveau");
    expect(body).not.toContain("cité");
    expect(quoted).toContain("cité");
  });

  it("inclut la ligne d'attribution juste avant le bloc cité", () => {
    const html = `<div>Salut</div><div>On Thu, Jun 25, 2026 at 3:38 PM a@b wrote:</div><blockquote>vieux</blockquote>`;
    const { body, quoted } = splitQuotedHtml(html);
    expect(body).toContain("Salut");
    expect(body).not.toMatch(/wrote:/);
    expect(quoted).toMatch(/wrote:/);
    expect(quoted).toContain("vieux");
  });

  it("contenu neuf + citation dans le MÊME wrapper → ne perd pas le neuf", () => {
    // Régression : Outlook/Apple Mail enveloppent texte neuf ET citation dans un
    // même `<div dir="auto">`. Remonter au top-level mettait TOUT en citation.
    const html = `<div dir="auto"><div>Réponse neuve de Paul</div><br><blockquote>historique cité</blockquote></div>`;
    const { body, quoted } = splitQuotedHtml(html);
    expect(body).toContain("Réponse neuve de Paul");
    expect(body).not.toContain("historique cité");
    expect(quoted).toContain("historique cité");
  });

  it("wrapper n'enveloppant QUE la citation → absorbé (pas de div vide résiduel)", () => {
    const html = `<div>Neuf</div><div class="wrap"><blockquote>vieux</blockquote></div>`;
    const { body, quoted } = splitQuotedHtml(html);
    expect(body).toBe("<div>Neuf</div>");
    expect(quoted).toContain("vieux");
  });

  it("sans citation → tout en body", () => {
    const { body, quoted } = splitQuotedHtml("<p>Juste un message</p>");
    expect(body).toContain("Juste un message");
    expect(quoted).toBe("");
  });

  it("vide → vide", () => {
    expect(splitQuotedHtml("")).toEqual({ body: "", quoted: "" });
  });
});

describe("sanitizeEmailHtml", () => {
  it("conserve le HTML de mise en forme basique", () => {
    const out = sanitizeEmailHtml("<p>Bonjour <b>Ada</b></p>");
    expect(out).toContain("Bonjour");
    expect(out).toContain("<b>Ada</b>");
  });

  it("retire les balises <script>", () => {
    const out = sanitizeEmailHtml('<p>ok</p><script>alert("xss")</script>');
    expect(out).toContain("ok");
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("alert");
  });

  it("retire les balises <style>", () => {
    const out = sanitizeEmailHtml("<style>body{display:none}</style><p>contenu</p>");
    expect(out).toContain("contenu");
    expect(out.toLowerCase()).not.toContain("<style");
  });

  it("retire les attributs on* (handlers JS)", () => {
    const out = sanitizeEmailHtml('<img src="x" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("neutralise les URI javascript: sur les liens", () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">clic</a>');
    expect(out).not.toContain("javascript:");
    expect(out).toContain("clic");
  });

  it("force target=_blank et rel=noopener noreferrer sur les liens", () => {
    const out = sanitizeEmailHtml('<a href="https://exemple.test">site</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("https://exemple.test");
  });

  it("retire <iframe>/<object>/<embed>", () => {
    const out = sanitizeEmailHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><embed src="y">',
    );
    const lower = out.toLowerCase();
    expect(lower).not.toContain("<iframe");
    expect(lower).not.toContain("<object");
    expect(lower).not.toContain("<embed");
  });

  it("retire les éléments de formulaire", () => {
    const out = sanitizeEmailHtml('<form action="/steal"><input name="pw"><button>go</button></form>');
    const lower = out.toLowerCase();
    expect(lower).not.toContain("<form");
    expect(lower).not.toContain("<input");
    expect(lower).not.toContain("<button");
  });

  it("conserve l'attribut style inline (mise en forme du mail)", () => {
    const out = sanitizeEmailHtml('<p style="color:red">rouge</p>');
    expect(out).toContain("rouge");
    expect(out).toContain("style=");
  });

  it("retire le CSS d'overlay dangereux (position/inset/z-index) mais garde le bénin", () => {
    const out = sanitizeEmailHtml(
      '<div style="position:fixed;inset:0;z-index:9999;color:red">piège</div>',
    );
    const lower = out.toLowerCase();
    expect(lower).not.toContain("position");
    expect(lower).not.toContain("inset");
    expect(lower).not.toContain("z-index");
    expect(lower).not.toContain("9999");
    // Le style bénin (couleur) reste.
    expect(lower).toContain("color");
    expect(out).toContain("piège");
  });

  it("retire top/right/bottom/left et position absolute", () => {
    const out = sanitizeEmailHtml(
      '<div style="position:absolute;top:0;left:0;right:0;bottom:0">x</div>',
    );
    const lower = out.toLowerCase();
    expect(lower).not.toContain("position");
    expect(lower).not.toMatch(/\btop\b/);
    expect(lower).not.toMatch(/\bleft\b/);
    expect(lower).not.toMatch(/\bright\b/);
    expect(lower).not.toMatch(/\bbottom\b/);
  });

  it("conserve position: relative (en-flux, non dangereux)", () => {
    const out = sanitizeEmailHtml('<div style="position:relative;color:blue">ok</div>');
    const lower = out.toLowerCase();
    expect(lower).toContain("position");
    expect(lower).toContain("relative");
    expect(lower).toContain("color");
  });

  it("laisse passer une image cid: best-effort sans planter", () => {
    const out = sanitizeEmailHtml('<img src="cid:logo123">');
    // Ne plante pas ; l'image peut ne pas charger (cid non résolu) — acceptable.
    expect(typeof out).toBe("string");
  });

  it("entrée vide → chaîne vide", () => {
    expect(sanitizeEmailHtml("")).toBe("");
  });

  it("idempotent sur plusieurs appels (hook lien non empilé)", () => {
    const a = sanitizeEmailHtml('<a href="https://x.test">l</a>');
    const b = sanitizeEmailHtml('<a href="https://x.test">l</a>');
    expect(a).toBe(b);
    // Un seul rel, pas de duplication d'attribut.
    expect((a.match(/rel=/g) ?? []).length).toBe(1);
  });
});
