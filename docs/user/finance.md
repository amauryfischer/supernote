# Finance personnelle

Le module finance te permet de suivre ton patrimoine, tes actifs, tes prêts et tes objectifs financiers — entièrement local, sans accès à tes comptes bancaires.

> Pas de scraping bancaire, pas de credentials, pas d'API bancaire. Mise à jour manuelle des soldes, ou import OFX/CSV. Les cours live (actions, crypto) sont des données publiques optionnelles.

---

## Les types d'entités

### Account — Compte

Un compte bancaire, d'épargne, d'investissement ou de crypto.

| Champ | Type | Description |
|---|---|---|
| `name` | texte (requis) | Nom du compte |
| `kind` | select | courant / épargne / livret / PEA / CTO / assurance-vie / crypto / autre |
| `institution` | relation → Organisation | Banque ou courtier |
| `currency` | select | EUR / USD / CHF / GBP / … |
| `iban` | texte | IBAN (optionnel) |
| `current_balance` | currency | Solde actuel |
| `last_synced_at` | datetime | Dernière mise à jour du solde |

---

### Asset — Actif

Un actif que tu détiens : actions, immo, crypto, obligations, fonds.

**Champs communs :**

| Champ | Type | Description |
|---|---|---|
| `name` | texte (requis) | Nom de l'actif |
| `category` | select | real_estate / stock / crypto / bond / fund / cash / other |
| `acquisition_date` | date | Date d'achat |
| `acquisition_value` | currency | Prix d'acquisition |
| `current_value` | currency ou formula | Valeur actuelle |
| `account` | relation → Account | Compte porteur |

**Champs conditionnels par catégorie :**

**Actions (`stock`) :**
- `ticker` : symbole boursier (ex : `AAPL`, `MC.PA`)
- `shares` : nombre de titres
- `currency` : devise de cotation
- Prix live via Yahoo Finance (opt-in dans Settings > Finance)

**Crypto :**
- `symbol` : symbole (ex : `BTC`, `ETH`)
- `quantity` : quantité
- Prix live via CoinGecko (opt-in, pas de clé API requise)

**Immobilier (`real_estate`) :**
- `address` : adresse
- `surface_sqm` : surface m²
- `loan` : relation → Loan (prêt associé)
- `valuation_method` : manuelle / index / expert
- `last_valuation_at` : date de la dernière estimation

**Obligations et fonds :**
- `isin` : code ISIN
- `units` : nombre de parts
- Prix via Yahoo Finance ou manuel

---

### Loan — Prêt

Suit un emprunt avec calcul d'amortissement automatique.

| Champ | Type | Description |
|---|---|---|
| `name` | texte (requis) | Nom du prêt |
| `principal` | currency (requis) | Capital emprunté |
| `rate_annual` | percent | Taux annuel |
| `term_months` | number | Durée en mois |
| `start_date` | date | Date de début |
| `kind` | select | immobilier / conso / perso / auto / étudiant / autre |
| `lender` | relation → Organisation | Prêteur |
| `monthly_payment` | formula | Mensualité calculée automatiquement |
| `remaining_principal` | formula | Capital restant dû |
| `end_date` | formula | Date de fin calculée |

Un bloc Query "Voir le tableau d'amortissement" est disponible sur chaque fiche Loan.

---

### Snapshot — Bilan patrimonial

Un état figé de ton patrimoine à un instant T.

| Champ | Type | Description |
|---|---|---|
| `name` | texte | Nom (ex : "Bilan mai 2026") |
| `taken_at` | datetime | Timestamp du snapshot |
| `total_net_worth` | currency | Actif net calculé |
| `breakdown` | longtext | Détail par catégorie (JSON) |
| `notes` | texte | Commentaires libres |

**Prendre un snapshot** : depuis le Dashboard Finance, clic "Prendre un snapshot maintenant". Toutes les valeurs courantes sont figées.

---

### Goal — Objectif financier

| Champ | Type | Description |
|---|---|---|
| `name` | texte (requis) | Ex : "Constituer épargne de précaution" |
| `target_amount` | currency | Montant cible |
| `target_date` | date | Date cible |
| `category` | select | épargne / investissement / dette / patrimoine |
| `current_progress` | formula | Calculé depuis les actifs filtrés |

---

## Dashboard Finance

```
[screenshot: dashboard finance avec metric cards et chart d'évolution]
```

Le Dashboard Finance (accessible depuis la sidebar > Finance) affiche :

- **Net worth actuel** : somme des actifs moins les dettes
- **Total cash** : total des comptes courants + épargne
- **Total actifs** : toutes les valeurs
- **Total dettes** : capital restant dû sur les prêts
- **Chart d'évolution** : courbe du net worth dans le temps (depuis les snapshots)
- **Table par catégorie** : actifs groupés (immo, actions, crypto, cash…)

---

## Vues Finance

| Vue | Description |
|---|---|
| Comptes | Table de tous les comptes avec totaux |
| Actifs | Kanban groupé par catégorie |
| Loans | Timeline des remboursements + chart amortissement |
| Snapshots | Timeline avec diff entre snapshots |
| Objectifs | Progress bars + ETA basée sur la tendance |

---

## Prix live (opt-in)

Les cours en temps réel sont **désactivés par défaut**. Pour les activer :

1. Settings > Finance > "Activer les prix live"
2. Accepte que Supernote aille chercher des données sur Yahoo Finance / CoinGecko
3. Les cours sont mis en cache localement avec un TTL (15min pour l'intraday, 24h pour le quotidien)

La routine seed **"Refresh patrimoine"** tourne chaque jour à 18h et met à jour tous les actifs avec ticker.

---

## Importer des données

- **OFX / QFX** : export de la plupart des banques françaises. Importe les transactions pour mettre à jour les soldes.
- **CSV** : format configurable (mapping colonnes).

Voir [Import / Export](import-export.md) pour les détails.

---

## Confidentialité

Les données finance restent dans ton vault. Si tu veux les isoler :

1. Crée un sous-dossier `Finance/` dédié
2. Dans Settings > Vaults, tu peux configurer un vault séparé pour ta finance
3. Le chiffrement passe par ton OS (FileVault, BitLocker, LUKS) — pas de chiffrement applicatif ajouté
