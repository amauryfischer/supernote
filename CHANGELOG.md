# Changelog

All notable changes to Supernote will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Actions IA sur sélection texte dans l'éditeur (reformat, summarize, fix-spelling) avec streaming inline Ollama local. Toolbar, clic droit, raccourcis Cmd+K Cmd+R/S/C, palette via Cmd+K Cmd+P.
- Bases — parité Coda : footer agrégat par colonne (sum/avg/count/min/max/median/range/earliest/latest/uniques/%-remplis/etc.), vue détail (fiche), vue graphique (recharts : bar/line/area/pie), vue formulaire interne (soumission → entité), vue chronologie (Gantt simple). Schéma View étendu avec `summarize`, `conditionalFormats`, `chartConfig`, `formConfig`, `timelineConfig` (migrations idempotentes ADD COLUMN).
- Bases — moteur de mise en forme conditionnelle (`conditional-format.ts`) + builder UI accessible depuis BaseToolbar (bouton « Format »). Règles persistées dans `view.conditionalFormats`, scope cell ou row, 8 swatches couleur + gras/italique.
- Bases — type de colonne « IA » : prompt template avec interpolation `{fieldName}`, sortie typée (text/longtext/number/bool/select), bouton ✨ par cellule pour générer via Ollama local. Schéma `FieldDefinition` étendu avec `aiPrompt`, `aiOutputKind`, `aiModel`, `aiAutoRecompute`.

<!-- Add new changes here under the appropriate heading:

### Changed
### Deprecated
### Removed
### Fixed
### Security

-->

[Unreleased]: https://github.com/your-org/supernote/compare/HEAD...HEAD
