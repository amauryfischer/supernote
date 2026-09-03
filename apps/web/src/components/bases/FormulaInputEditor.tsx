"use client";

/**
 * FormulaInputEditor — éditeur de formule avec coloration syntaxique
 * et autocomplétion contextuelle.
 *
 * Architecture :
 *  - Tokenizer interne (regex) → liste de tokens typés
 *  - Overlay coloré rendu derrière un <textarea> transparent
 *  - Détection contextuelle au curseur : après `.` on propose les
 *    propriétés valides pour le type de la LHS (champ de base, agrégat
 *    de liste, propriété de ligne…).
 *  - Parse final via @supernote/formulas pour valider avant submit.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "@phosphor-icons/react";
import type { EntityType, Field } from "@supernote/core";
import { parseFormula, inferFormulaOutputKind, type FormulaAST } from "@supernote/formulas";
import { trpc } from "@/lib/trpc/client";
import { ipcEntityTypeToCore } from "@/components/schemas/adapters";
import { breadcrumb } from "@/lib/diagnostics/freeze-watchdog";

// ── Catalogue stdlib ─────────────────────────────────────────────────────────

interface FnSpec {
  name: string;
  sig: string;
  /** Catégorie pour l'aide. */
  group: "text" | "math" | "date" | "logic" | "list" | "entity";
  /** Description courte affichée dans le popup d'aide. */
  doc?: string;
  /** Exemple inline. */
  example?: string;
}

const FUNCTIONS: FnSpec[] = [
  // Texte
  { name: "Concatenate", sig: "Concatenate(a, b, …)", group: "text" },
  { name: "Concat", sig: "Concat(a, b, …)", group: "text" },
  { name: "Format", sig: "Format(tpl, …) | Format(date, fmt)", group: "text" },
  { name: "Upper", sig: "Upper(s)", group: "text" },
  { name: "Lower", sig: "Lower(s)", group: "text" },
  { name: "Proper", sig: "Proper(s)", group: "text" },
  { name: "Trim", sig: "Trim(s)", group: "text" },
  { name: "Left", sig: "Left(s, n)", group: "text" },
  { name: "Right", sig: "Right(s, n)", group: "text" },
  { name: "Middle", sig: "Middle(s, start, len)", group: "text" },
  { name: "Substring", sig: "Substring(s, start, end?)", group: "text" },
  { name: "Find", sig: "Find(haystack, needle)", group: "text" },
  { name: "Replace", sig: "Replace(s, from, to)", group: "text" },
  { name: "Split", sig: "Split(s, sep)", group: "text" },
  { name: "Contains", sig: "Contains(s | list, x)", group: "text" },
  { name: "StartsWith", sig: "StartsWith(s, prefix)", group: "text" },
  { name: "EndsWith", sig: "EndsWith(s, suffix)", group: "text" },
  { name: "RegexMatch", sig: "RegexMatch(s, pattern)", group: "text" },
  { name: "Slugify", sig: "Slugify(s)", group: "text" },
  { name: "RepeatString", sig: "RepeatString(s, n)", group: "text" },
  { name: "Length", sig: "Length(s | list)", group: "text" },
  { name: "Len", sig: "Len(s | list)", group: "text" },
  { name: "ToText", sig: "ToText(v)", group: "text" },
  { name: "ToNumber", sig: "ToNumber(v)", group: "text" },
  // Maths
  { name: "Sum", sig: "Sum(list | …nums)", group: "math" },
  { name: "Average", sig: "Average(list | …nums)", group: "math" },
  { name: "Avg", sig: "Avg(list | …nums)", group: "math" },
  { name: "Median", sig: "Median(list)", group: "math" },
  { name: "Product", sig: "Product(list | …nums)", group: "math" },
  { name: "Min", sig: "Min(list | …nums)", group: "math" },
  { name: "Max", sig: "Max(list | …nums)", group: "math" },
  { name: "Count", sig: "Count(list)", group: "math" },
  { name: "CountIf", sig: "CountIf(list, predicate)", group: "math" },
  { name: "Abs", sig: "Abs(n)", group: "math" },
  { name: "Round", sig: "Round(n, decimals?)", group: "math" },
  { name: "RoundUp", sig: "RoundUp(n, decimals?)", group: "math" },
  { name: "RoundDown", sig: "RoundDown(n, decimals?)", group: "math" },
  { name: "Ceil", sig: "Ceil(n)", group: "math" },
  { name: "Floor", sig: "Floor(n)", group: "math" },
  { name: "Int", sig: "Int(n)", group: "math" },
  { name: "Sign", sig: "Sign(n)", group: "math" },
  { name: "Pow", sig: "Pow(base, exp)", group: "math" },
  { name: "Sqrt", sig: "Sqrt(n)", group: "math" },
  { name: "Mod", sig: "Mod(a, b)", group: "math" },
  { name: "Log", sig: "Log(n, base?)", group: "math" },
  { name: "Ln", sig: "Ln(n)", group: "math" },
  { name: "Exp", sig: "Exp(n)", group: "math" },
  { name: "Sin", sig: "Sin(n)", group: "math" },
  { name: "Cos", sig: "Cos(n)", group: "math" },
  { name: "Tan", sig: "Tan(n)", group: "math" },
  { name: "Random", sig: "Random()", group: "math" },
  { name: "RandomBetween", sig: "RandomBetween(lo, hi)", group: "math" },
  { name: "Sequence", sig: "Sequence(start, end, step?)", group: "math" },
  { name: "PI", sig: "PI()", group: "math" },
  { name: "E", sig: "E()", group: "math" },
  // Dates
  { name: "Now", sig: "Now()", group: "date" },
  { name: "Today", sig: "Today()", group: "date" },
  { name: "Date", sig: "Date(year, month, day)", group: "date" },
  { name: "Time", sig: "Time(h, m, s)", group: "date" },
  { name: "DateAdd", sig: "DateAdd(date, n, unit)", group: "date" },
  { name: "DateDiff", sig: "DateDiff(a, b, unit)", group: "date" },
  { name: "Year", sig: "Year(date)", group: "date" },
  { name: "Month", sig: "Month(date)", group: "date" },
  { name: "Day", sig: "Day(date)", group: "date" },
  { name: "Hour", sig: "Hour(date)", group: "date" },
  { name: "Minute", sig: "Minute(date)", group: "date" },
  { name: "Second", sig: "Second(date)", group: "date" },
  { name: "Weekday", sig: "Weekday(date)", group: "date" },
  { name: "WeekdayName", sig: "WeekdayName(date)", group: "date" },
  { name: "MonthName", sig: "MonthName(date)", group: "date" },
  { name: "WeekOfYear", sig: "WeekOfYear(date)", group: "date" },
  { name: "Quarter", sig: "Quarter(date)", group: "date" },
  { name: "ParseDate", sig: "ParseDate(s)", group: "date" },
  // Logique
  { name: "If", sig: "If(cond, then, else)", group: "logic" },
  { name: "IfElse", sig: "IfElse(c1, v1, …, default)", group: "logic" },
  { name: "IfBlank", sig: "IfBlank(value, fallback)", group: "logic" },
  { name: "Switch", sig: "Switch(value, c1, v1, …, default)", group: "logic" },
  { name: "SwitchIf", sig: "SwitchIf(c1, v1, …, default)", group: "logic" },
  { name: "And", sig: "And(a, b, …)", group: "logic" },
  { name: "Or", sig: "Or(a, b, …)", group: "logic" },
  { name: "Not", sig: "Not(b)", group: "logic" },
  { name: "IsBlank", sig: "IsBlank(v)", group: "logic" },
  { name: "IsNotBlank", sig: "IsNotBlank(v)", group: "logic" },
  { name: "IsNumber", sig: "IsNumber(v)", group: "logic" },
  { name: "IsText", sig: "IsText(v)", group: "logic" },
  { name: "IsList", sig: "IsList(v)", group: "logic" },
  { name: "IsBoolean", sig: "IsBoolean(v)", group: "logic" },
  { name: "IsDate", sig: "IsDate(v)", group: "logic" },
  { name: "True", sig: "True()", group: "logic" },
  { name: "False", sig: "False()", group: "logic" },
  // Listes
  { name: "Filter", sig: "Filter(list, x -> pred)", group: "list" },
  { name: "Where", sig: "Where(list, currentValue.x > …)", group: "list" },
  { name: "Map", sig: "Map(list, x -> expr)", group: "list" },
  { name: "Reduce", sig: "Reduce(list, fn, init)", group: "list" },
  { name: "Sort", sig: "Sort(list, key?)", group: "list" },
  { name: "Reverse", sig: "Reverse(list)", group: "list" },
  { name: "Unique", sig: "Unique(list)", group: "list" },
  { name: "GroupBy", sig: "GroupBy(list, key)", group: "list" },
  { name: "First", sig: "First(list)", group: "list" },
  { name: "Last", sig: "Last(list)", group: "list" },
  { name: "Nth", sig: "Nth(list, i)", group: "list" },
  { name: "Take", sig: "Take(list, n)", group: "list" },
  { name: "Drop", sig: "Drop(list, n)", group: "list" },
  { name: "Slice", sig: "Slice(list, start, end?)", group: "list" },
  { name: "Join", sig: "Join(list, sep)", group: "list" },
  { name: "In", sig: "In(value, list)", group: "list" },
  { name: "RandomItem", sig: "RandomItem(list)", group: "list" },
  { name: "ListConcat", sig: "ListConcat(a, b, …)", group: "list" },
  // Dates — sucre Bloc 1
  { name: "DateOnly", sig: "DateOnly(d)", group: "date" },
  { name: "StartOfDay", sig: "StartOfDay(d)", group: "date" },
  { name: "EndOfDay", sig: "EndOfDay(d)", group: "date" },
  { name: "StartOfMonth", sig: "StartOfMonth(d)", group: "date" },
  { name: "EndOfMonth", sig: "EndOfMonth(d)", group: "date" },
  { name: "StartOfYear", sig: "StartOfYear(d)", group: "date" },
  { name: "EndOfYear", sig: "EndOfYear(d)", group: "date" },
  { name: "StartOfWeek", sig: "StartOfWeek(d, weekStart?)", group: "date" },
  { name: "EndOfWeek", sig: "EndOfWeek(d, weekStart?)", group: "date" },
  // Durations
  { name: "Days", sig: "Days(n)", group: "date" },
  { name: "Hours", sig: "Hours(n)", group: "date" },
  { name: "Minutes", sig: "Minutes(n)", group: "date" },
  { name: "Seconds", sig: "Seconds(n)", group: "date" },
  { name: "Weeks", sig: "Weeks(n)", group: "date" },
  { name: "Months", sig: "Months(n)", group: "date" },
  { name: "Years", sig: "Years(n)", group: "date" },
  // Prédicats date
  { name: "IsBefore", sig: "IsBefore(a, b)", group: "date" },
  { name: "IsAfter", sig: "IsAfter(a, b)", group: "date" },
  { name: "IsBetween", sig: "IsBetween(d, a, b)", group: "date" },
  { name: "IsSameDay", sig: "IsSameDay(a, b)", group: "date" },
  { name: "IsToday", sig: "IsToday(d)", group: "date" },
  { name: "IsYesterday", sig: "IsYesterday(d)", group: "date" },
  { name: "IsTomorrow", sig: "IsTomorrow(d)", group: "date" },
  { name: "IsThisWeek", sig: "IsThisWeek(d)", group: "date" },
  { name: "IsThisMonth", sig: "IsThisMonth(d)", group: "date" },
  { name: "IsThisYear", sig: "IsThisYear(d)", group: "date" },
  { name: "IsPast", sig: "IsPast(d)", group: "date" },
  { name: "IsFuture", sig: "IsFuture(d)", group: "date" },
  { name: "IsWeekend", sig: "IsWeekend(d)", group: "date" },
  { name: "IsWeekday", sig: "IsWeekday(d)", group: "date" },
  { name: "IsLeapYear", sig: "IsLeapYear(d)", group: "date" },
  // Format
  { name: "FormatDate", sig: "FormatDate(d, fmt)", group: "date" },
  { name: "ToISO", sig: "ToISO(d)", group: "date" },
  { name: "ToUnix", sig: "ToUnix(d)", group: "date" },
  { name: "FromUnix", sig: "FromUnix(n)", group: "date" },
  { name: "FromISO", sig: "FromISO(s)", group: "date" },
  { name: "FromNow", sig: "FromNow(d)", group: "date" },
  { name: "FormatRelative", sig: "FormatRelative(d)", group: "date" },
  // Calendrier
  { name: "BusinessDaysBetween", sig: "BusinessDaysBetween(a, b)", group: "date" },
  { name: "AddBusinessDays", sig: "AddBusinessDays(d, n)", group: "date" },
  { name: "DaysInMonth", sig: "DaysInMonth(d)", group: "date" },
  { name: "DaysInYear", sig: "DaysInYear(d)", group: "date" },
  // Logique Bloc 3
  { name: "Coalesce", sig: "Coalesce(a, b, …)", group: "logic", doc: "Retourne le premier argument non-null/vide." },
  { name: "NullIf", sig: "NullIf(a, b)", group: "logic", doc: "Retourne null si a == b, sinon retourne a." },
  { name: "Try", sig: "Try(expr, fallback?)", group: "logic", doc: "Évalue expr ; retourne fallback en cas d'erreur." },
  // Listes Bloc 4 (fonctions autonomes)
  { name: "Any", sig: "Any(list, pred?)", group: "list" },
  { name: "All", sig: "All(list, pred?)", group: "list" },
  { name: "None", sig: "None(list, pred?)", group: "list" },
  { name: "Includes", sig: "Includes(list, x)", group: "list" },
  { name: "IndexOf", sig: "IndexOf(list, x)", group: "list" },
  { name: "Flatten", sig: "Flatten(list)", group: "list" },
  { name: "FlatMap", sig: "FlatMap(list, x -> list)", group: "list" },
  { name: "Chunk", sig: "Chunk(list, n)", group: "list" },
  { name: "Zip", sig: "Zip(a, b)", group: "list" },
  { name: "Partition", sig: "Partition(list, x -> bool)", group: "list" },
  { name: "DistinctBy", sig: "DistinctBy(list, x -> key)", group: "list" },
  { name: "SortBy", sig: "SortBy(list, x -> key)", group: "list" },
  { name: "SortByDesc", sig: "SortByDesc(list, x -> key)", group: "list" },
  { name: "MaxBy", sig: "MaxBy(list, x -> key)", group: "list" },
  { name: "MinBy", sig: "MinBy(list, x -> key)", group: "list" },
  { name: "SumBy", sig: "SumBy(list, x -> num)", group: "list" },
  { name: "AvgBy", sig: "AvgBy(list, x -> num)", group: "list" },
  { name: "CountBy", sig: "CountBy(list, x -> key)", group: "list" },
  { name: "Compact", sig: "Compact(list)", group: "list" },
  { name: "IsEmpty", sig: "IsEmpty(list)", group: "list" },
  { name: "IsNotEmpty", sig: "IsNotEmpty(list)", group: "list" },
  { name: "Mode", sig: "Mode(list)", group: "math" },
  { name: "Range", sig: "Range(list)", group: "math" },
  { name: "Stddev", sig: "Stddev(list)", group: "math" },
  { name: "Variance", sig: "Variance(list)", group: "math" },
  { name: "Percentile", sig: "Percentile(list, p)", group: "math" },
  // Entités
  { name: "Lookup", sig: "Lookup(typeName, predicate)", group: "entity" },
  { name: "Backlinks", sig: "Backlinks(entity)", group: "entity" },
  { name: "Tags", sig: "Tags(entity)", group: "entity" },
  // Texte — extension
  { name: "ContainsText", sig: "ContainsText(s, sub)", group: "text", doc: "Contient (insensible à la casse)" },
  { name: "EqualsIgnoreCase", sig: "EqualsIgnoreCase(a, b)", group: "text" },
  { name: "StartsWithIgnoreCase", sig: "StartsWithIgnoreCase(s, prefix)", group: "text" },
  { name: "EndsWithIgnoreCase", sig: "EndsWithIgnoreCase(s, suffix)", group: "text" },
  { name: "FindIgnoreCase", sig: "FindIgnoreCase(haystack, needle)", group: "text" },
  { name: "Substitute", sig: "Substitute(s, find, replace, occurrence?)", group: "text" },
  { name: "Char", sig: "Char(code)", group: "text" },
  { name: "Code", sig: "Code(char)", group: "text" },
  { name: "Repeat", sig: "Repeat(s, n)", group: "text" },
  { name: "Truncate", sig: "Truncate(s, maxLen, suffix?)", group: "text" },
  { name: "Lines", sig: "Lines(s)", group: "text" },
  { name: "Words", sig: "Words(s)", group: "text" },
  { name: "Sentences", sig: "Sentences(s)", group: "text" },
  { name: "LineCount", sig: "LineCount(s)", group: "text" },
  { name: "WordCount", sig: "WordCount(s)", group: "text" },
  { name: "StripHtml", sig: "StripHtml(s)", group: "text" },
  { name: "StripMarkdown", sig: "StripMarkdown(s)", group: "text" },
  { name: "EscapeHtml", sig: "EscapeHtml(s)", group: "text" },
  { name: "UnescapeHtml", sig: "UnescapeHtml(s)", group: "text" },
  { name: "EscapeRegex", sig: "EscapeRegex(s)", group: "text" },
  { name: "UrlEncode", sig: "UrlEncode(s)", group: "text" },
  { name: "UrlDecode", sig: "UrlDecode(s)", group: "text" },
  { name: "Base64Encode", sig: "Base64Encode(s)", group: "text" },
  { name: "Base64Decode", sig: "Base64Decode(s)", group: "text" },
  { name: "PadStart", sig: "PadStart(s, len, char?)", group: "text" },
  { name: "PadEnd", sig: "PadEnd(s, len, char?)", group: "text" },
  { name: "CamelCase", sig: "CamelCase(s)", group: "text" },
  { name: "KebabCase", sig: "KebabCase(s)", group: "text" },
  { name: "SnakeCase", sig: "SnakeCase(s)", group: "text" },
  { name: "PascalCase", sig: "PascalCase(s)", group: "text" },
  { name: "TitleCase", sig: "TitleCase(s)", group: "text" },
  { name: "LeftOf", sig: "LeftOf(s, sep)", group: "text" },
  { name: "RightOf", sig: "RightOf(s, sep)", group: "text" },
  { name: "Between", sig: "Between(s, start, end)", group: "text" },
  { name: "Pluralize", sig: "Pluralize(word, n)", group: "text" },
  { name: "Hash", sig: "Hash(s)", group: "text" },
  { name: "ParseNumber", sig: "ParseNumber(s)", group: "text" },
  { name: "Reverse", sig: "Reverse(s | list)", group: "text" },
  // Regex
  { name: "RegexExtract", sig: "RegexExtract(s, pattern, group?)", group: "text" },
  { name: "RegexExtractAll", sig: "RegexExtractAll(s, pattern, group?)", group: "text" },
  { name: "RegexSplit", sig: "RegexSplit(s, pattern)", group: "text" },
  { name: "RegexEscape", sig: "RegexEscape(s)", group: "text" },
  // JSON
  { name: "ToJson", sig: "ToJson(v)", group: "text" },
  { name: "FromJson", sig: "FromJson(s)", group: "text" },
  { name: "JsonPath", sig: "JsonPath(obj, path)", group: "text" },
  // Maths — extension
  { name: "Square", sig: "Square(n)", group: "math" },
  { name: "Cube", sig: "Cube(n)", group: "math" },
  { name: "Power", sig: "Power(base, exp)", group: "math" },
  { name: "IsInteger", sig: "IsInteger(n)", group: "math" },
  { name: "IsFinite", sig: "IsFinite(n)", group: "math" },
  { name: "IsNaN", sig: "IsNaN(n)", group: "math" },
  { name: "IsPositive", sig: "IsPositive(n)", group: "math" },
  { name: "IsNegative", sig: "IsNegative(n)", group: "math" },
  { name: "IsZero", sig: "IsZero(n)", group: "math" },
  { name: "IsEven", sig: "IsEven(n)", group: "math" },
  { name: "IsOdd", sig: "IsOdd(n)", group: "math" },
  { name: "Gcd", sig: "Gcd(a, b)", group: "math" },
  { name: "Lcm", sig: "Lcm(a, b)", group: "math" },
  { name: "Factorial", sig: "Factorial(n)", group: "math" },
  { name: "Clamp", sig: "Clamp(n, lo, hi)", group: "math" },
  { name: "Lerp", sig: "Lerp(a, b, t)", group: "math" },
  { name: "MapRange", sig: "MapRange(n, inMin, inMax, outMin, outMax)", group: "math" },
  { name: "Trunc", sig: "Trunc(n)", group: "math" },
  { name: "Frac", sig: "Frac(n)", group: "math" },
  { name: "Atan2", sig: "Atan2(y, x)", group: "math" },
  { name: "Asin", sig: "Asin(n)", group: "math" },
  { name: "Acos", sig: "Acos(n)", group: "math" },
  { name: "Atan", sig: "Atan(n)", group: "math" },
  { name: "Sinh", sig: "Sinh(n)", group: "math" },
  { name: "Cosh", sig: "Cosh(n)", group: "math" },
  { name: "Tanh", sig: "Tanh(n)", group: "math" },
  { name: "FormatBytes", sig: "FormatBytes(n)", group: "math" },
  { name: "FormatOrdinal", sig: "FormatOrdinal(n)", group: "math" },
  { name: "FormatPercent", sig: "FormatPercent(n, decimals?)", group: "math" },
  { name: "FormatCurrency", sig: "FormatCurrency(n, code?)", group: "math" },
  { name: "FormatNumber", sig: "FormatNumber(n)", group: "math" },
  // Dates — extension
  { name: "IsValidDate", sig: "IsValidDate(v)", group: "date" },
  { name: "DateMin", sig: "DateMin(a, b, …)", group: "date" },
  { name: "DateMax", sig: "DateMax(a, b, …)", group: "date" },
  { name: "DateRange", sig: "DateRange(start, end, stepDays?)", group: "date" },
  { name: "ParseDuration", sig: "ParseDuration(s)", group: "date" },
  { name: "FormatDuration", sig: "FormatDuration(ms)", group: "date" },
  { name: "HumanDuration", sig: "HumanDuration(ms)", group: "date" },
  // Logique — extension
  { name: "IfNull", sig: "IfNull(value, fallback)", group: "logic" },
  { name: "Implies", sig: "Implies(a, b)", group: "logic" },
  { name: "Xor", sig: "Xor(a, b)", group: "logic" },
  { name: "Nand", sig: "Nand(a, b)", group: "logic" },
  { name: "Nor", sig: "Nor(a, b)", group: "logic" },
  { name: "ToBool", sig: "ToBool(v)", group: "logic" },
  { name: "ToDate", sig: "ToDate(v)", group: "logic" },
  { name: "ToList", sig: "ToList(v)", group: "logic" },
  { name: "TypeOf", sig: "TypeOf(v)", group: "logic" },
  // Listes — extension
  { name: "TakeWhile", sig: "TakeWhile(list, x -> bool)", group: "list" },
  { name: "DropWhile", sig: "DropWhile(list, x -> bool)", group: "list" },
  { name: "Scan", sig: "Scan(list, (acc, x) -> acc, init)", group: "list" },
  { name: "Tally", sig: "Tally(list)", group: "list" },
  { name: "RepeatList", sig: "RepeatList(item, n)", group: "list" },
  { name: "ConcatAll", sig: "ConcatAll(a, b, …)", group: "list" },
  { name: "Union", sig: "Union(a, b)", group: "list" },
  { name: "Intersect", sig: "Intersect(a, b)", group: "list" },
  { name: "Difference", sig: "Difference(a, b)", group: "list" },
  { name: "Without", sig: "Without(list, …vals)", group: "list" },
  { name: "Sample", sig: "Sample(list, n?)", group: "list" },
  { name: "Shuffle", sig: "Shuffle(list)", group: "list" },
  { name: "Pairwise", sig: "Pairwise(list)", group: "list" },
  { name: "Unzip", sig: "Unzip(list)", group: "list" },
  { name: "ContainsAll", sig: "ContainsAll(list, others)", group: "list" },
  { name: "ContainsAny", sig: "ContainsAny(list, others)", group: "list" },
  { name: "ContainsNone", sig: "ContainsNone(list, others)", group: "list" },
  { name: "FindIndex", sig: "FindIndex(list, x -> bool)", group: "list" },
  { name: "ListFind", sig: "ListFind(list, x -> bool)", group: "list" },
  // Entités — extension
  { name: "Get", sig: "Get(entity, field, default?)", group: "entity" },
  { name: "Has", sig: "Has(entity, field)", group: "entity" },
  { name: "EntityId", sig: "EntityId(entity)", group: "entity" },
  { name: "CreatedAt", sig: "CreatedAt(entity)", group: "entity" },
  { name: "UpdatedAt", sig: "UpdatedAt(entity)", group: "entity" },
  { name: "FindAll", sig: "FindAll(typeName, pred?)", group: "entity" },
  { name: "CountOf", sig: "CountOf(typeName, pred?)", group: "entity" },
];

const FUNCTION_NAMES_SET = new Set(FUNCTIONS.map((f) => f.name));

// Documentation courte pour les fonctions usuelles. Affichée dans le popup.
const FUNCTION_DOCS: Record<string, { doc: string; example?: string }> = {
  If:        { doc: "Renvoie `then` si `cond` est vraie, sinon `else`.", example: 'If({montant} > 100, "gros", "petit")' },
  IfBlank:   { doc: "Renvoie `fallback` si la valeur est vide/null, sinon la valeur.", example: 'IfBlank({nom}, "Sans nom")' },
  Filter:    { doc: "Filtre une liste (ou une base) selon un prédicat.", example: 'Filter("Contact", c -> c.age > 18)' },
  Where:     { doc: "Filtre Coda-style avec `currentValue`.", example: 'Contact.where(currentValue.age > 18)' },
  Sum:       { doc: "Somme des nombres d'une liste ou des arguments." },
  Average:   { doc: "Moyenne des nombres." },
  Count:     { doc: "Compte les éléments d'une liste." },
  Concatenate: { doc: "Concatène plusieurs chaînes.", example: 'Concatenate({prenom}, " ", {nom})' },
  Format:    { doc: "Format(\"Hello {0}\", name) ou Format(date, \"YYYY-MM-DD\").", example: 'Format({date}, "DD/MM/YYYY")' },
  Now:       { doc: "Date/heure actuelle." },
  Today:     { doc: "Date du jour (00:00)." },
  DateAdd:   { doc: "Ajoute n unités à une date.", example: 'DateAdd(Today(), 7, "day")' },
  DateDiff:  { doc: "Différence entre deux dates dans l'unité donnée.", example: 'DateDiff({debut}, {fin}, "day")' },
  Round:     { doc: "Arrondi à n décimales.", example: "Round({prix}, 2)" },
  Lookup:    { doc: "Suit une relation à partir d'une entité.", example: 'Lookup({contact}, "client")' },
  Map:       { doc: "Transforme chaque élément d'une liste.", example: "Contact.Map(c -> c.email)" },
};

function fnSnippet(sig: string, name: string): { insertText: string; cursorDelta: number } {
  const open = sig.indexOf("(");
  const close = sig.lastIndexOf(")");
  if (open < 0 || close < 0 || open + 1 === close) {
    return { insertText: `${name}()`, cursorDelta: 0 };
  }
  const args = sig.slice(open + 1, close).split(",").map((a) => a.trim()).filter(Boolean);
  // Coupe sur `|` (variantes alternatives) → on garde la première variante
  const cleaned = args.map((a) => a.split("|")[0]!.trim().replace(/[…?]/g, "").trim() || "arg");
  const placeholders = cleaned.map((a) => `<${a}>`).join(", ");
  return { insertText: `${name}(${placeholders})`, cursorDelta: 0 };
}

function fnDoc(name: string): { doc: string; example?: string } | null {
  const explicit = FUNCTION_DOCS[name];
  if (explicit) return explicit;
  const fn = FUNCTIONS.find((f) => f.name === name);
  if (fn?.doc) return { doc: fn.doc, example: fn.example };
  return null;
}

const KEYWORDS = new Set([
  "thisRow", "currentValue",
  "true", "false", "TRUE", "FALSE",
  "null", "NULL",
  "and", "or", "not", "AND", "OR", "NOT",
]);

/** Méthodes/propriétés valides sur une liste (chained). */
const LIST_MEMBERS: FnSpec[] = [
  { name: "count", sig: "count → number", group: "list" },
  { name: "length", sig: "length → number", group: "list" },
  { name: "sum", sig: "sum → number", group: "list" },
  { name: "avg", sig: "avg → number", group: "list" },
  { name: "min", sig: "min → number", group: "list" },
  { name: "max", sig: "max → number", group: "list" },
  { name: "first", sig: "first → item", group: "list" },
  { name: "last", sig: "last → item", group: "list" },
  { name: "any", sig: "any → bool", group: "list" },
  { name: "all", sig: "all → bool", group: "list" },
  { name: "none", sig: "none → bool", group: "list" },
  { name: "isEmpty", sig: "isEmpty → bool", group: "list" },
  { name: "isNotEmpty", sig: "isNotEmpty → bool", group: "list" },
  { name: "compact", sig: "compact → list", group: "list" },
  { name: "flatten", sig: "flatten → list", group: "list" },
  { name: "distinct", sig: "distinct → list", group: "list" },
  { name: "median", sig: "median → number", group: "list" },
  { name: "stddev", sig: "stddev → number", group: "list" },
  { name: "variance", sig: "variance → number", group: "list" },
  { name: "where", sig: "where(currentValue …)", group: "list" },
  { name: "Filter", sig: "Filter(x -> pred)", group: "list" },
  { name: "Map", sig: "Map(x -> expr)", group: "list" },
  { name: "Sort", sig: "Sort(key?)", group: "list" },
  { name: "SortBy", sig: "SortBy(x -> key)", group: "list" },
  { name: "SortByDesc", sig: "SortByDesc(x -> key)", group: "list" },
  { name: "Reverse", sig: "Reverse()", group: "list" },
  { name: "Unique", sig: "Unique()", group: "list" },
  { name: "DistinctBy", sig: "DistinctBy(x -> key)", group: "list" },
  { name: "Take", sig: "Take(n)", group: "list" },
  { name: "Drop", sig: "Drop(n)", group: "list" },
  { name: "Slice", sig: "Slice(start, end?)", group: "list" },
  { name: "Join", sig: "Join(sep)", group: "list" },
  { name: "Count", sig: "Count()", group: "list" },
  { name: "Sum", sig: "Sum()", group: "list" },
  { name: "Any", sig: "Any(pred?)", group: "list" },
  { name: "All", sig: "All(pred?)", group: "list" },
  { name: "None", sig: "None(pred?)", group: "list" },
  { name: "Includes", sig: "Includes(x)", group: "list" },
  { name: "IndexOf", sig: "IndexOf(x)", group: "list" },
  { name: "Flatten", sig: "Flatten()", group: "list" },
  { name: "FlatMap", sig: "FlatMap(x -> list)", group: "list" },
  { name: "Compact", sig: "Compact()", group: "list" },
  { name: "Partition", sig: "Partition(x -> bool)", group: "list" },
  { name: "Chunk", sig: "Chunk(n)", group: "list" },
  { name: "MaxBy", sig: "MaxBy(x -> key)", group: "list" },
  { name: "MinBy", sig: "MinBy(x -> key)", group: "list" },
  { name: "SumBy", sig: "SumBy(x -> num)", group: "list" },
  { name: "AvgBy", sig: "AvgBy(x -> num)", group: "list" },
  { name: "CountBy", sig: "CountBy(x -> key)", group: "list" },
  { name: "GroupBy", sig: "GroupBy(x -> key)", group: "list" },
  // Extension
  { name: "TakeWhile", sig: "TakeWhile(x -> bool)", group: "list" },
  { name: "DropWhile", sig: "DropWhile(x -> bool)", group: "list" },
  { name: "Scan", sig: "Scan((acc, x) -> acc, init)", group: "list" },
  { name: "FindIndex", sig: "FindIndex(x -> bool)", group: "list" },
  { name: "ListFind", sig: "ListFind(x -> bool)", group: "list" },
  { name: "ContainsAll", sig: "ContainsAll(others)", group: "list" },
  { name: "ContainsAny", sig: "ContainsAny(others)", group: "list" },
  { name: "ContainsNone", sig: "ContainsNone(others)", group: "list" },
  { name: "Union", sig: "Union(other)", group: "list" },
  { name: "Intersect", sig: "Intersect(other)", group: "list" },
  { name: "Difference", sig: "Difference(other)", group: "list" },
  { name: "Pairwise", sig: "Pairwise()", group: "list" },
  { name: "Unzip", sig: "Unzip()", group: "list" },
  { name: "Tally", sig: "Tally()", group: "list" },
  { name: "Shuffle", sig: "Shuffle()", group: "list" },
  { name: "Sample", sig: "Sample(n?)", group: "list" },
  { name: "Without", sig: "Without(…vals)", group: "list" },
  { name: "Zip", sig: "Zip(other)", group: "list" },
];

/** Méthodes/propriétés chainables sur une string. */
const STRING_MEMBERS: FnSpec[] = [
  { name: "upper", sig: "upper → string", group: "text" },
  { name: "lower", sig: "lower → string", group: "text" },
  { name: "proper", sig: "proper → string", group: "text" },
  { name: "trim", sig: "trim → string", group: "text" },
  { name: "trimStart", sig: "trimStart → string", group: "text" },
  { name: "trimEnd", sig: "trimEnd → string", group: "text" },
  { name: "length", sig: "length → number", group: "text" },
  { name: "reverse", sig: "reverse → string", group: "text" },
  { name: "slugify", sig: "slugify → string", group: "text" },
  { name: "isBlank", sig: "isBlank → bool", group: "text" },
  { name: "isEmpty", sig: "isEmpty → bool", group: "text" },
  { name: "isNotBlank", sig: "isNotBlank → bool", group: "text" },
  { name: "isNotEmpty", sig: "isNotEmpty → bool", group: "text" },
  { name: "isNull", sig: "isNull → bool", group: "text" },
  { name: "isNotNull", sig: "isNotNull → bool", group: "text" },
  // Methods with args (desugared by parser to FunctionCall)
  { name: "Contains", sig: "Contains(sub)", group: "text" },
  { name: "StartsWith", sig: "StartsWith(prefix)", group: "text" },
  { name: "EndsWith", sig: "EndsWith(suffix)", group: "text" },
  { name: "Split", sig: "Split(sep)", group: "text" },
  { name: "Replace", sig: "Replace(find, to)", group: "text" },
  { name: "Find", sig: "Find(needle)", group: "text" },
  { name: "Left", sig: "Left(n)", group: "text" },
  { name: "Right", sig: "Right(n)", group: "text" },
  { name: "PadStart", sig: "PadStart(len, char?)", group: "text" },
  { name: "PadEnd", sig: "PadEnd(len, char?)", group: "text" },
  { name: "Repeat", sig: "Repeat(n)", group: "text" },
  { name: "Substring", sig: "Substring(start, end?)", group: "text" },
  { name: "Truncate", sig: "Truncate(maxLen, suffix?)", group: "text" },
  { name: "ContainsText", sig: "ContainsText(sub)", group: "text" },
  { name: "LeftOf", sig: "LeftOf(sep)", group: "text" },
  { name: "RightOf", sig: "RightOf(sep)", group: "text" },
];

// ── Chain type resolution ─────────────────────────────────────────────────────

type ChainResolution =
  | { kind: "base"; base: EntityType }
  | { kind: "list-of-base"; base: EntityType }
  | { kind: "scalar"; inferredKind: "string" | "number" | "date" | "bool" }
  | null;

type InferredFieldKind = "string" | "number" | "date" | "bool";

function fieldKindToChainKind(kind: string): InferredFieldKind | null {
  if (kind === "number" || kind === "currency" || kind === "percent" || kind === "rating" || kind === "progress" || kind === "duration" || kind === "autoNumber") return "number";
  if (kind === "date" || kind === "datetime" || kind === "createdAt" || kind === "updatedAt") return "date";
  if (kind === "bool") return "bool";
  if (kind === "text" || kind === "longtext" || kind === "url" || kind === "email" || kind === "phone" || kind === "color" || kind === "markdown") return "string";
  return null;
}

/** Méthodes/propriétés chainables sur un nombre. */
const NUMBER_MEMBERS: FnSpec[] = [
  { name: "abs", sig: "abs → number", group: "math" },
  { name: "round", sig: "round → number", group: "math" },
  { name: "ceil", sig: "ceil → number", group: "math" },
  { name: "floor", sig: "floor → number", group: "math" },
  { name: "sign", sig: "sign → number", group: "math" },
  { name: "isInteger", sig: "isInteger → bool", group: "math" },
  { name: "isPositive", sig: "isPositive → bool", group: "math" },
  { name: "isNegative", sig: "isNegative → bool", group: "math" },
  { name: "isZero", sig: "isZero → bool", group: "math" },
  { name: "isEven", sig: "isEven → bool", group: "math" },
  { name: "isOdd", sig: "isOdd → bool", group: "math" },
  { name: "isNull", sig: "isNull → bool", group: "math" },
  { name: "isNotNull", sig: "isNotNull → bool", group: "math" },
];

/** Méthodes/propriétés chainables sur une date. */
const DATE_MEMBERS: FnSpec[] = [
  { name: "year", sig: "year → number", group: "date" },
  { name: "month", sig: "month → number", group: "date" },
  { name: "day", sig: "day → number", group: "date" },
  { name: "hour", sig: "hour → number", group: "date" },
  { name: "minute", sig: "minute → number", group: "date" },
  { name: "second", sig: "second → number", group: "date" },
  { name: "startOfDay", sig: "startOfDay → date", group: "date" },
  { name: "endOfDay", sig: "endOfDay → date", group: "date" },
  { name: "startOfMonth", sig: "startOfMonth → date", group: "date" },
  { name: "endOfMonth", sig: "endOfMonth → date", group: "date" },
  { name: "isToday", sig: "isToday → bool", group: "date" },
  { name: "isPast", sig: "isPast → bool", group: "date" },
  { name: "isFuture", sig: "isFuture → bool", group: "date" },
  { name: "toISO", sig: "toISO → string", group: "date" },
  { name: "isNull", sig: "isNull → bool", group: "date" },
  { name: "isNotNull", sig: "isNotNull → bool", group: "date" },
];

/** Méthodes/propriétés chainables sur un booléen. */
const BOOL_MEMBERS: FnSpec[] = [
  { name: "not", sig: "not → bool", group: "logic" },
  { name: "isNull", sig: "isNull → bool", group: "logic" },
  { name: "isNotNull", sig: "isNotNull → bool", group: "logic" },
];

/**
 * Resolves the type of the expression at `dotPos` by walking the dot-chain
 * backward through relation fields.
 */
function resolveChainTypeAt(
  src: string,
  dotPos: number,
  basesByName: Map<string, EntityType>,
  basesById: Map<string, EntityType>,
  rootBase: EntityType,
): ChainResolution {
  const segments: string[] = [];
  let pos = dotPos - 1;
  if (pos >= 0 && src[pos] === "?") pos--;

  while (pos >= 0) {
    while (pos >= 0 && /\s/.test(src[pos] ?? "")) pos--;
    if (pos < 0) break;
    let segEnd = pos + 1;
    while (pos >= 0 && /[A-Za-z0-9_]/.test(src[pos] ?? "")) pos--;
    const seg = src.slice(pos + 1, segEnd);
    if (!seg) break;
    segments.unshift(seg);
    while (pos >= 0 && /\s/.test(src[pos] ?? "")) pos--;
    if (pos >= 0 && src[pos] === ".") {
      if (pos > 0 && src[pos - 1] === "?") pos--;
      pos--;
      continue;
    }
    break;
  }

  if (segments.length === 0) return null;

  const root = segments[0]!;
  let currentBase: EntityType | null = null;
  let isList = false;

  if (root === "thisRow" || root === "currentValue") {
    currentBase = rootBase;
    isList = false;
  } else {
    const b = basesByName.get(root);
    if (b) {
      currentBase = b;
      isList = true;
    }
  }

  if (!currentBase) return null;
  if (segments.length === 1) {
    return isList
      ? { kind: "list-of-base", base: currentBase }
      : { kind: "base", base: currentBase };
  }

  const maxDepth = Math.min(segments.length - 1, 5);
  for (let i = 1; i <= maxDepth; i++) {
    const seg = segments[i]!;
    const field = currentBase.fields.find((f) => f.name === seg || f.id === seg);
    if (!field) return null;

    if (field.kind === "relation") {
      const relField = field as import("@supernote/core").RelationField;
      const target = basesById.get(relField.targetTypeId);
      if (!target) return null;
      const isMany = relField.cardinality === "one_to_many" || relField.cardinality === "many_to_many";
      currentBase = target;
      isList = isMany;
    } else {
      const scalarKind = fieldKindToChainKind(field.kind);
      if (!scalarKind) return null;
      return { kind: "scalar", inferredKind: scalarKind };
    }

    if (i === maxDepth) {
      return isList
        ? { kind: "list-of-base", base: currentBase }
        : { kind: "base", base: currentBase };
    }
  }

  return null;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type TokKind =
  | "fn" | "base" | "field" | "keyword" | "string" | "number"
  | "operator" | "punct" | "ident" | "member" | "variable" | "whitespace";

interface Tok {
  kind: TokKind;
  start: number;
  end: number;
  text: string;
}

interface LookupTables {
  baseNames: Set<string>;
  fieldNames: Set<string>;
  variableNames: Set<string>;
}

function tokenize(src: string, tables: LookupTables): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let prevNonWs: Tok | null = null;
  const pushTok = (t: Tok): void => {
    out.push(t);
    if (t.kind !== "whitespace") prevNonWs = t;
  };
  const peekPrev = (): Tok | null => prevNonWs;
  while (i < src.length) {
    const c = src[i]!;
    // whitespace
    if (/\s/.test(c)) {
      let j = i;
      while (j < src.length && /\s/.test(src[j]!)) j++;
      pushTok({ kind: "whitespace", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // string
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, src.length);
      pushTok({ kind: "string", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // variable $ident
    if (c === "$") {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      pushTok({ kind: "variable", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // number
    if (/\d/.test(c) || (c === "." && /\d/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < src.length && /[\d.]/.test(src[j]!)) j++;
      pushTok({ kind: "number", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // field ref {slug}
    if (c === "{") {
      let j = i + 1;
      while (j < src.length && src[j] !== "}") j++;
      j = Math.min(j + 1, src.length);
      pushTok({ kind: "field", start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // identifier
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const text = src.slice(i, j);
      let kind: TokKind = "ident";
      // si précédé d'un dot (token operator ".") → c'est un member
      const prev = peekPrev();
      if (prev && prev.kind === "operator" && prev.text === ".") {
        kind = "member";
      } else if (KEYWORDS.has(text)) kind = "keyword";
      else if (FUNCTION_NAMES_SET.has(text)) kind = "fn";
      else if (tables.baseNames.has(text)) kind = "base";
      else if (tables.fieldNames.has(text)) kind = "field";
      pushTok({ kind, start: i, end: j, text });
      i = j;
      continue;
    }
    // operators / punctuation
    if (/[+\-*/%=<>!&|.,()[\]?]/.test(c)) {
      let j = i + 1;
      // multi-char ops
      const two = src.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||", "->", "<>", "??", "?."].includes(two)) j = i + 2;
      const kind: TokKind = /[()[\],]/.test(c) ? "punct" : "operator";
      pushTok({ kind, start: i, end: j, text: src.slice(i, j) });
      i = j;
      continue;
    }
    // fallback
    pushTok({ kind: "ident", start: i, end: i + 1, text: c });
    i++;
  }
  return out;
}

const TOKEN_COLORS: Record<TokKind, string | null> = {
  fn: "#8B5CF6",         // violet
  base: "#10B981",       // vert
  field: "#3B82F6",      // bleu
  keyword: "#EAB308",    // ambre
  string: "#16A34A",     // vert sombre
  number: "#EA580C",     // orange
  operator: "var(--text-muted)",
  punct: "var(--text-muted)",
  ident: "var(--text-primary)",
  member: "#A855F7",     // violet clair
  variable: "#F59E0B",   // ambre vif
  whitespace: null,
};

// ── Completion ───────────────────────────────────────────────────────────────

type CompletionMode =
  | "free"
  | "member-of-base"
  | "member-of-list"
  | "member-of-row"
  | "member-of-string"
  | "member-of-number"
  | "member-of-date"
  | "member-of-bool"
  | "rhs-suggestion";

interface CompletionItem {
  label: string;
  kind: "function" | "base" | "field" | "keyword" | "member" | "variable";
  insertText: string;
  cursorDelta?: number;
  detail?: string;
}

interface ContextInfo {
  /** Mode actif. */
  mode: CompletionMode;
  /** Mot en cours (suffixe à filtrer). */
  prefix: string;
  /** Plage à remplacer dans la source. */
  start: number;
  end: number;
  /** Si mode = member-of-base : la base ciblée. */
  contextBase?: EntityType;
  /** Si mode = rhs-suggestion : suggestions contextuelles pré-calculées. */
  rhsSuggestions?: CompletionItem[];
}

/**
 * Quand on est dans `<base>.where(...)` / `.Filter(...)` / `.Map(...)` / `.Sort(...)` /
 * `.Reduce(...)` autour du curseur, retourne la base ciblée par le `currentValue`.
 * Scan backward depuis le curseur en équilibrant les parenthèses pour trouver
 * l'appel de méthode englobant, puis l'identifiant receiver avant le `.`.
 */
function enclosingCurrentValueBase(
  src: string,
  cursor: number,
  basesByName: Map<string, EntityType>,
): EntityType | undefined {
  const METHODS = new Set(["where", "Filter", "Map", "Sort", "Reduce", "GroupBy", "WhereBy"]);
  let depth = 0;
  let i = cursor - 1;
  while (i >= 0) {
    const c = src[i]!;
    // saute strings
    if (c === '"' || c === "'") {
      const q = c;
      i--;
      while (i >= 0 && src[i] !== q) i--;
      i--;
      continue;
    }
    if (c === ")") { depth++; i--; continue; }
    if (c === "(") {
      if (depth === 0) {
        // identifier juste avant le `(` = nom de méthode
        let j = i - 1;
        while (j >= 0 && /\s/.test(src[j] ?? "")) j--;
        let methodEnd = j + 1;
        while (j >= 0 && /[A-Za-z0-9_]/.test(src[j] ?? "")) j--;
        const method = src.slice(j + 1, methodEnd);
        if (METHODS.has(method)) {
          // attendu `.` puis identifier receiver
          let k = j;
          while (k >= 0 && /\s/.test(src[k] ?? "")) k--;
          if (k >= 0 && src[k] === ".") {
            let recvEnd = k;
            let recvStart = k;
            while (recvStart > 0 && /[A-Za-z0-9_]/.test(src[recvStart - 1] ?? "")) recvStart--;
            const recv = src.slice(recvStart, recvEnd);
            const b = basesByName.get(recv);
            if (b) return b;
          }
        }
        // on continue en remontant plus haut au cas où imbrication
        i = j;
        continue;
      }
      depth--; i--; continue;
    }
    i--;
  }
  return undefined;
}

/**
 * Détermine si un identifiant correspond à un champ de type texte dans la base courante.
 * Utilisé pour détecter si on devrait proposer STRING_MEMBERS.
 */
function isTextFieldIdent(ident: string, base: EntityType): boolean {
  const f = base.fields.find((x) => x.name === ident || x.id === ident);
  if (!f) return false;
  const TEXT_KINDS = new Set(["text", "longtext", "url", "email", "phone", "markdown"]);
  return TEXT_KINDS.has(f.kind);
}

const COMPARISON_OPS = new Set(["==", "!=", "<", "<=", ">", ">=", "=", "<>"]);

/**
 * Détecte si le curseur est en RHS d'une comparaison.
 * Remonte en arrière depuis le curseur pour trouver l'opérateur de comparaison et son LHS.
 * Retourne l'identifiant LHS ou undefined.
 */
function enclosingComparisonLhs(
  src: string,
  cursor: number,
): { lhsIdent: string; lhsProp?: string } | undefined {
  // On scan en arrière depuis le curseur pour trouver l'opérateur
  let i = cursor - 1;
  // Saute le préfixe en cours (word chars)
  while (i >= 0 && /[A-Za-z0-9_.]/.test(src[i] ?? "")) i--;
  // Saute whitespace
  while (i >= 0 && /\s/.test(src[i] ?? "")) i--;

  // Essaie de matcher un opérateur de comparaison
  let opStart = i;
  // Multi-char ops (<= >= == != <>)
  const twoChar = src.slice(Math.max(0, i - 1), i + 1);
  if (COMPARISON_OPS.has(twoChar)) {
    opStart = i - 1;
  } else if (COMPARISON_OPS.has(src[i] ?? "")) {
    opStart = i;
  } else {
    return undefined;
  }

  // LHS : ce qui précède l'opérateur
  let j = opStart - 1;
  while (j >= 0 && /\s/.test(src[j] ?? "")) j--;
  // Collecte l'identifiant (possiblement `thisRow.field` ou `currentValue.field`)
  let lhsEnd = j + 1;
  while (j >= 0 && /[A-Za-z0-9_]/.test(src[j] ?? "")) j--;
  const lhsProp = src.slice(j + 1, lhsEnd);
  // Vérifie si c'est précédé d'un `.`
  let k = j;
  while (k >= 0 && /\s/.test(src[k] ?? "")) k--;
  if (k >= 0 && src[k] === ".") {
    let baseEnd = k;
    let baseStart = k;
    while (baseStart > 0 && /[A-Za-z0-9_]/.test(src[baseStart - 1] ?? "")) baseStart--;
    const lhsIdent = src.slice(baseStart, baseEnd);
    if (lhsIdent) return { lhsIdent, lhsProp };
  }
  if (lhsProp) return { lhsIdent: lhsProp };
  return undefined;
}

function contextAtCursor(
  src: string,
  cursor: number,
  basesByName: Map<string, EntityType>,
  basesById: Map<string, EntityType>,
  base?: EntityType,
): ContextInfo {
  // Mot courant (identifier alphanum) à la position curseur
  let start = cursor;
  while (start > 0 && /[A-Za-z0-9_]/.test(src[start - 1] ?? "")) start--;
  let end = cursor;
  while (end < src.length && /[A-Za-z0-9_]/.test(src[end] ?? "")) end++;
  let prefix = src.slice(start, end);

  // Préfixe `$` : on l'inclut dans la plage à remplacer pour proposer les variables
  if (start > 0 && src[start - 1] === "$") {
    start -= 1;
    prefix = "$" + prefix;
  }

  // Avant ce mot : est-on précédé d'un `.` (ou `?.`) ?
  let p = start - 1;
  while (p >= 0 && /\s/.test(src[p] ?? "")) p--;
  const prevChar = src[p] ?? "";
  const isDot = prevChar === ".";
  const isOptionalDot = prevChar === "." && p > 0 && src[p - 1] === "?";

  if (isDot) {
    // identifier juste avant le `.`
    let dotPos = isOptionalDot ? p - 1 : p;
    let identEnd = dotPos;
    let identStart = dotPos;
    while (identStart > 0 && /[A-Za-z0-9_]/.test(src[identStart - 1] ?? "")) identStart--;
    const ident = src.slice(identStart, identEnd);
    if (ident) {
      // Use chain resolver for multi-segment chains
      const rootBase = base ?? { id: "", name: "", plural: "", fields: [], defaultPath: "", fileNamePattern: "" };
      const resolved = resolveChainTypeAt(src, isOptionalDot ? p - 1 : p, basesByName, basesById, rootBase);

      if (resolved) {
        if (resolved.kind === "base") {
          return { mode: "member-of-row", prefix, start, end, contextBase: resolved.base };
        }
        if (resolved.kind === "list-of-base") {
          if (basesByName.has(ident)) {
            return { mode: "member-of-base", prefix, start, end, contextBase: resolved.base };
          }
          return { mode: "member-of-list", prefix, start, end, contextBase: resolved.base };
        }
        if (resolved.kind === "scalar") {
          if (resolved.inferredKind === "string") return { mode: "member-of-string", prefix, start, end };
          if (resolved.inferredKind === "number") return { mode: "member-of-number", prefix, start, end };
          if (resolved.inferredKind === "date") return { mode: "member-of-date", prefix, start, end };
          if (resolved.inferredKind === "bool") return { mode: "member-of-bool", prefix, start, end };
        }
      }

      // Fallback: single-segment heuristics
      if (ident === "thisRow") return { mode: "member-of-row", prefix, start, end };
      const b = basesByName.get(ident);
      if (b) return { mode: "member-of-base", prefix, start, end, contextBase: b };
      if (ident === "currentValue") {
        const enclosing = enclosingCurrentValueBase(src, identStart, basesByName);
        if (enclosing) return { mode: "member-of-row", prefix, start, end, contextBase: enclosing };
        return { mode: "member-of-row", prefix, start, end };
      }
      if (base && isTextFieldIdent(ident, base)) return { mode: "member-of-string", prefix, start, end };
      return { mode: "member-of-list", prefix, start, end };
    }
  }

  // Détection RHS de comparaison (Bloc 5)
  if (base) {
    const lhs = enclosingComparisonLhs(src, cursor);
    if (lhs) {
      const fieldName = lhs.lhsProp ?? lhs.lhsIdent;
      const field = base.fields.find((f) => f.name === fieldName || f.id === fieldName);
      if (field) {
        const suggestions = buildRhsSuggestions(field, base);
        if (suggestions.length > 0) {
          return { mode: "rhs-suggestion", prefix, start, end, rhsSuggestions: suggestions };
        }
      }
    }
  }

  return { mode: "free", prefix, start, end };
}

/** Construit les suggestions contextuelles RHS selon le type du champ LHS. */
function buildRhsSuggestions(field: import("@supernote/core").Field, _base: EntityType): CompletionItem[] {
  const out: CompletionItem[] = [];
  const k = field.kind;
  if (k === "date" || k === "datetime" || k === "createdAt" || k === "updatedAt") {
    out.push({ label: "Today()", kind: "keyword", insertText: "Today()", detail: "aujourd'hui" });
    out.push({ label: "Now()", kind: "keyword", insertText: "Now()", detail: "maintenant" });
    out.push({ label: "DateAdd(Today(), -7, \"day\")", kind: "keyword", insertText: 'DateAdd(Today(), -7, "day")', detail: "-7 jours" });
    out.push({ label: "StartOfMonth(Today())", kind: "keyword", insertText: "StartOfMonth(Today())", detail: "début mois" });
    out.push({ label: "EndOfMonth(Today())", kind: "keyword", insertText: "EndOfMonth(Today())", detail: "fin mois" });
  } else if (k === "bool") {
    out.push({ label: "true", kind: "keyword", insertText: "true" });
    out.push({ label: "false", kind: "keyword", insertText: "false" });
  } else if (k === "select" || k === "multiselect") {
    const opts = (field as { options?: Array<{ value?: string; label?: string }> }).options ?? [];
    for (const opt of opts) {
      const val = opt.value ?? opt.label ?? "";
      if (val) out.push({ label: `"${val}"`, kind: "keyword", insertText: `"${val}"`, detail: "option" });
    }
  } else if (k === "relation" || k === "rollup") {
    out.push({ label: `Lookup(thisRow.${field.name}, "")`, kind: "keyword", insertText: `Lookup(thisRow.${field.name}, "")`, detail: "lookup relation" });
  }
  return out;
}

function buildCompletions(
  ctx: ContextInfo,
  base: EntityType,
  bases: EntityType[],
  variables: string[] = [],
): CompletionItem[] {
  if (ctx.mode === "member-of-string") {
    return STRING_MEMBERS.map((m): CompletionItem => ({
      label: m.name,
      kind: "member",
      insertText: m.name,
      detail: m.sig,
    }));
  }
  if (ctx.mode === "member-of-number") {
    return NUMBER_MEMBERS.map((m): CompletionItem => ({
      label: m.name,
      kind: "member",
      insertText: m.name,
      detail: m.sig,
    }));
  }
  if (ctx.mode === "member-of-date") {
    return DATE_MEMBERS.map((m): CompletionItem => ({
      label: m.name,
      kind: "member",
      insertText: m.name,
      detail: m.sig,
    }));
  }
  if (ctx.mode === "member-of-bool") {
    return BOOL_MEMBERS.map((m): CompletionItem => ({
      label: m.name,
      kind: "member",
      insertText: m.name,
      detail: m.sig,
    }));
  }
  if (ctx.mode === "rhs-suggestion") {
    const suggestions = ctx.rhsSuggestions ?? [];
    // Also append free completions below suggestions
    const freeCtx: ContextInfo = { ...ctx, mode: "free" };
    const freeItems = buildCompletions(freeCtx, base, bases, variables);
    return [...suggestions, ...freeItems];
  }
  if (ctx.mode === "member-of-base" && ctx.contextBase) {
    const fields = ctx.contextBase.fields.map((f): CompletionItem => ({
      label: f.label || f.name,
      kind: "field",
      insertText: f.name || f.id,
      detail: f.kind,
    }));
    const listMembers = LIST_MEMBERS.map((m): CompletionItem => {
      const hasParens = m.sig.includes("(") && !m.sig.startsWith(m.name + " ");
      const snip = hasParens ? fnSnippet(m.sig, m.name) : { insertText: m.name, cursorDelta: 0 };
      return {
        label: m.name,
        kind: "member",
        insertText: snip.insertText,
        cursorDelta: snip.cursorDelta,
        detail: m.sig,
      };
    });
    return [...fields, ...listMembers];
  }
  if (ctx.mode === "member-of-row") {
    // Si on est dans un .where(currentValue.…) / .Filter / .Map sur une autre
    // base, ctx.contextBase pointe sur la base parcourue : on propose SES champs.
    const rowBase = ctx.contextBase ?? base;
    return rowBase.fields.map((f): CompletionItem => ({
      label: f.label || f.name,
      kind: "field",
      insertText: f.name || f.id,
      detail: f.kind,
    }));
  }
  if (ctx.mode === "member-of-list") {
    const listItems = LIST_MEMBERS.map((m): CompletionItem => ({
      label: m.name,
      kind: "member",
      insertText: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? `${m.name}()` : m.name,
      cursorDelta: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? -1 : 0,
      detail: m.sig,
    }));
    if (ctx.contextBase) {
      const fieldItems = ctx.contextBase.fields.map((f): CompletionItem => ({
        label: f.label || f.name,
        kind: "field",
        insertText: f.name || f.id,
        detail: `${f.kind} (projection)`,
      }));
      return [...listItems, ...fieldItems];
    }
    return listItems;
  }
  // mode free
  const fns = FUNCTIONS.map((f): CompletionItem => {
    const snip = fnSnippet(f.sig, f.name);
    return {
      label: f.name,
      kind: "function",
      insertText: snip.insertText,
      cursorDelta: snip.cursorDelta,
      detail: f.sig,
    };
  });
  const baseItems = bases.flatMap((b): CompletionItem[] => {
    const out: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const cand of [b.name, b.plural].filter(Boolean) as string[]) {
      if (seen.has(cand)) continue;
      seen.add(cand);
      out.push({ label: cand, kind: "base", insertText: cand, detail: `${b.fields.length} champs` });
    }
    return out;
  });
  const fields = base.fields.map((f): CompletionItem => ({
    label: f.label || f.name,
    kind: "field",
    insertText: `{${f.name || f.id}}`,
    detail: f.kind,
  }));
  const kw: CompletionItem[] = [
    { label: "thisRow", kind: "keyword", insertText: "thisRow", detail: "ligne courante" },
    { label: "currentValue", kind: "keyword", insertText: "currentValue", detail: "item dans where/Filter" },
    { label: "true", kind: "keyword", insertText: "true" },
    { label: "false", kind: "keyword", insertText: "false" },
    { label: "null", kind: "keyword", insertText: "null" },
  ];
  const vars: CompletionItem[] = variables.map((name) => ({
    label: `$${name}`,
    kind: "variable",
    insertText: `$${name}`,
    detail: "variable globale",
  }));
  return [...fns, ...baseItems, ...fields, ...vars, ...kw];
}

// ── Param hints — détecte l'appel de fonction englobant ─────────────────────

function paramHintAtCursor(src: string, cursor: number): { name: string; argIndex: number } | null {
  let depth = 0;
  let commas = 0;
  let i = cursor - 1;
  while (i >= 0) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      const q = c;
      i--;
      while (i >= 0 && src[i] !== q) i--;
      i--;
      continue;
    }
    if (c === ")") { depth++; i--; continue; }
    if (c === "(") {
      if (depth === 0) {
        // ident juste avant
        let j = i - 1;
        while (j >= 0 && /\s/.test(src[j] ?? "")) j--;
        let end = j + 1;
        while (j >= 0 && /[A-Za-z0-9_]/.test(src[j] ?? "")) j--;
        const name = src.slice(j + 1, end);
        return name ? { name, argIndex: commas } : null;
      }
      depth--; i--; continue;
    }
    if (c === "," && depth === 0) commas++;
    i--;
  }
  return null;
}

function highlightParam(sig: string, argIndex: number): React.ReactNode {
  // signature ex : "Round(n, decimals?)". Trouve la parenthèse + split par virgule.
  const open = sig.indexOf("(");
  const close = sig.lastIndexOf(")");
  if (open < 0 || close < 0 || close < open) return sig;
  const head = sig.slice(0, open + 1);
  const tail = sig.slice(close);
  const params = sig.slice(open + 1, close).split(",").map((p) => p.trim());
  return (
    <>
      {head}
      {params.map((p, i) => (
        <span key={i}>
          {i > 0 && ", "}
          <span style={{ fontWeight: i === argIndex ? 700 : 400, color: i === argIndex ? "var(--accent)" : undefined }}>
            {p}
          </span>
        </span>
      ))}
      {tail}
    </>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

type FormulaOutputKind = "text" | "number" | "date" | "bool";

/** Mode d'affichage d'un bloc formula vivant dans une note. */
export type FormulaDisplay = "value" | "countdown" | "progress" | "sparkline";

const EMPTY_BASE: EntityType = {
  id: "",
  name: "",
  plural: "",
  fields: [],
  defaultPath: "",
  fileNamePattern: "",
};

interface FormulaInputEditorProps {
  /** Base courante pour résoudre `thisRow.*` et `{champ}`. Optionnel (variables globales, etc.). */
  base?: EntityType;
  /** Liste des noms de variables globales pour autocomplétion `$nom`. */
  variables?: string[];
  initialExpression?: string;
  initialOutputKind?: FormulaOutputKind;
  initialOutputFormat?: string;
  /** Mode d'affichage initial du bloc (notes — blocs vivants). */
  initialDisplay?: FormulaDisplay;
  /** Affiche le sélecteur de mode d'affichage. Caché par défaut (call-sites bases, etc.). */
  showDisplaySelector?: boolean;
  /** Texte du textarea. */
  placeholder?: string;
  /** Mode embarqué dans un formulaire externe : cache outputKind/format + boutons Annuler/Valider. */
  inline?: boolean;
  /** Appelé à chaque édition (mode inline ou autre — utile pour relier à un state parent). */
  onChange?: (expression: string) => void;
  onSubmit?: (expression: string, outputKind: FormulaOutputKind, display?: FormulaDisplay, outputFormat?: string) => void;
  onCancel?: () => void;
}

// ── Inférence de type + analyseur (warnings type-aware) ────────────────────

type InferredKind = "number" | "string" | "bool" | "date" | "duration" | "unknown";

function fieldKindToInferred(f: Field | undefined): InferredKind {
  if (!f) return "unknown";
  const k = f.kind;
  if (k === "number" || k === "currency" || k === "percent" || k === "rating" || k === "progress" || k === "duration" || k === "autoNumber") return "number";
  if (k === "date" || k === "datetime" || k === "createdAt" || k === "updatedAt") return "date";
  if (k === "bool") return "bool";
  if (k === "formula") return ((f as { outputKind?: InferredKind }).outputKind ?? "unknown");
  if (k === "rollup") return "number"; // approximation
  return "string";
}

function inferAstKind(ast: FormulaAST, base: EntityType): InferredKind {
  switch (ast.kind) {
    case "NumberLiteral": return "number";
    case "StringLiteral": return "string";
    case "BoolLiteral": return "bool";
    case "PropertyAccess": {
      const obj = ast.object;
      if (obj.kind === "Identifier" && (obj.name === "thisRow" || obj.name === "currentValue")) {
        const f = base.fields.find((x) => x.name === ast.property || x.id === ast.property);
        return fieldKindToInferred(f);
      }
      // Nested PropertyAccess: scalar.field → unknown
      if (obj.kind === "PropertyAccess") {
        const innerKind = inferAstKind(obj, base);
        if (innerKind !== "unknown") return "unknown";
      }
      return "unknown";
    }
    case "Identifier": {
      const f = base.fields.find((x) => x.name === ast.name || x.id === ast.name);
      if (f) return fieldKindToInferred(f);
      return "unknown";
    }
    case "FunctionCall": {
      const fn = FUNCTIONS.find((f) => f.name === ast.name);
      if (!fn) return "unknown";
      if (fn.group === "math") return "number";
      if (fn.group === "logic") return "bool";
      if (fn.group === "text") return (ast.name === "Length" || ast.name === "Len") ? "number" : "string";
      if (fn.group === "date") {
        const numerals = new Set(["Year","Month","Day","Hour","Minute","Second","Weekday","WeekOfYear","Quarter","DateDiff","ToUnix","DaysInMonth","DaysInYear","BusinessDaysBetween"]);
        const bools = new Set(["IsBefore","IsAfter","IsBetween","IsSameDay","IsToday","IsYesterday","IsTomorrow","IsThisWeek","IsThisMonth","IsThisYear","IsPast","IsFuture","IsWeekend","IsWeekday","IsLeapYear"]);
        const durations = new Set(["Days","Hours","Minutes","Seconds","Weeks","Months","Years"]);
        const strings = new Set(["ToISO","FromNow","FormatRelative","FormatDate"]);
        if (numerals.has(ast.name)) return "number";
        if (bools.has(ast.name)) return "bool";
        if (durations.has(ast.name)) return "duration";
        if (strings.has(ast.name)) return "string";
        return "date";
      }
      return "unknown";
    }
    case "BinaryOp": {
      const op = ast.op;
      if (op === "+") {
        const l = inferAstKind(ast.left, base);
        const r = inferAstKind(ast.right, base);
        if (l === "date" && r === "duration") return "date";
        if (l === "duration" && r === "date") return "date";
        if (l === "string" || r === "string") return "string";
        return "number";
      }
      if (op === "-") {
        const l = inferAstKind(ast.left, base);
        const r = inferAstKind(ast.right, base);
        if (l === "date" && r === "duration") return "date";
        if (l === "date" && r === "date") return "number"; // date-date = duration-ish number
        return "number";
      }
      if (op === "*" || op === "/" || op === "%") return "number";
      if (op === "==" || op === "!=" || op === "<" || op === "<=" || op === ">" || op === ">=" || op === "and" || op === "or") return "bool";
      // ?? — return RHS type as best guess
      return inferAstKind((ast as import("@supernote/formulas").BinaryOp).right, base);
    }
    case "Conditional": return inferAstKind(ast.consequent, base);
    default: return "unknown";
  }
}

function analyseFormula(ast: FormulaAST, base: EntityType): string[] {
  const warnings: string[] = [];
  // Arithmetic ops (not comparison): date is OK as operand for < <= > >=
  const strictNumericOps = new Set(["-", "*", "/", "%"]);
  const comparisonOps = new Set(["<", "<=", ">", ">="]);
  const visit = (n: FormulaAST): void => {
    if (n.kind === "BinaryOp") {
      const lk = inferAstKind(n.left, base);
      const rk = inferAstKind(n.right, base);
      if (strictNumericOps.has(n.op)) {
        // date - duration / date - date are OK
        const dateOk = (lk === "date" && (rk === "duration" || rk === "date")) ||
                       (lk === "duration" && rk === "date");
        if (!dateOk) {
          for (const [side, k] of [["gauche", lk], ["droit", rk]] as const) {
            if (k === "string" || k === "bool") {
              warnings.push(`Opérateur \`${n.op}\` attend un nombre — côté ${side} est de type ${k}.`);
            }
          }
        }
      }
      if (comparisonOps.has(n.op)) {
        // date < date, date > Today() etc. → OK, no warning
        for (const [side, k] of [["gauche", lk], ["droit", rk]] as const) {
          if (k === "string" || k === "bool") {
            warnings.push(`Opérateur \`${n.op}\` attend un nombre/date — côté ${side} est de type ${k}.`);
          }
        }
      }
      if (n.op === "==" || n.op === "!=") {
        // date == date OK, no warning
        if (lk !== "unknown" && rk !== "unknown" && lk !== rk && lk !== "date" && rk !== "date") {
          warnings.push(`Comparaison \`${n.op}\` entre ${lk} et ${rk} : conversion implicite.`);
        }
      }
      visit(n.left); visit(n.right);
    } else if (n.kind === "UnaryOp") {
      visit(n.operand);
    } else if (n.kind === "PropertyAccess") {
      visit(n.object);
    } else if (n.kind === "FunctionCall") {
      n.args.forEach(visit);
    } else if (n.kind === "Conditional") {
      visit(n.condition); visit(n.consequent); visit(n.alternate);
    } else if (n.kind === "ListLiteral") {
      n.elements.forEach(visit);
    } else if (n.kind === "Lambda") {
      visit(n.body);
    }
  };
  visit(ast);
  return warnings;
}

// ── Pretty-print (formatage simple par regex) ────────────────────────────────

function prettyPrint(src: string): string {
  // Espace autour des opérateurs binaires (sans casser `->` ni `-` unaire)
  // 1) Operateurs multi-char d'abord
  let out = src.replace(/\s*(==|!=|<=|>=|&&|\|\||->)\s*/g, " $1 ");
  // 2) Operateurs simples (espace seulement si autour de identifier/nombre/parenthèse)
  out = out.replace(/([A-Za-z0-9_)\]])\s*([+\-*/%<>])\s*([A-Za-z0-9_({[$"'])/g, "$1 $2 $3");
  // 3) Virgules : un espace après, jamais avant
  out = out.replace(/\s*,\s*/g, ", ");
  // 4) Espace après `(` à supprimer
  out = out.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
  // 5) Réduit espaces multiples
  out = out.replace(/[ \t]{2,}/g, " ");
  return out.trim();
}

// ── Fuzzy match (subsequence avec bonus de continuité + préfixe) ────────────

function fuzzyScore(label: string, query: string): number | null {
  if (!query) return 0;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  let score = 0;
  let lastIdx = -1;
  let matchedFirstChar = false;
  for (const ch of q) {
    const idx = l.indexOf(ch, i);
    if (idx < 0) return null;
    if (idx === 0) matchedFirstChar = true;
    if (lastIdx >= 0 && idx === lastIdx + 1) score += 3; // continuité
    if (idx === i) score += 2; // match attendu
    score -= idx - i;          // pénalité de saut
    lastIdx = idx;
    i = idx + 1;
  }
  if (l.startsWith(q)) score += 30;
  else if (matchedFirstChar) score += 5;
  return score;
}

// ── Composant ────────────────────────────────────────────────────────────────

export function FormulaInputEditor({
  base,
  variables,
  initialExpression = "",
  initialOutputKind = "text",
  initialOutputFormat,
  initialDisplay = "value",
  showDisplaySelector = false,
  placeholder,
  inline = false,
  onChange,
  onSubmit,
  onCancel,
}: FormulaInputEditorProps) {
  const baseSafe = base ?? EMPTY_BASE;

  // Fallback : si l'appelant ne fournit pas la liste, on la charge nous-mêmes
  // pour que `$` propose toujours les variables globales.
  const { data: variableList } = trpc.variables.list.useQuery(undefined, {
    enabled: variables === undefined,
  });
  const effectiveVariables = useMemo<string[]>(
    () => variables ?? (variableList ?? []).map((v) => v.name),
    [variables, variableList],
  );
  const [expression, setExpression] = useState(initialExpression);
  const [outputKind, setOutputKind] = useState<FormulaOutputKind>(initialOutputKind);
  const [outputFormat, setOutputFormat] = useState<string>(initialOutputFormat ?? "");
  // Mode d'affichage du bloc vivant — reste à la valeur initiale si sélecteur caché.
  const [display, setDisplay] = useState<FormulaDisplay>(initialDisplay);
  const [outputKindOverridden, setOutputKindOverridden] = useState(false);
  const [cursor, setCursor] = useState(initialExpression.length);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);

  // Auto-inference outputKind tant que user n'a pas override le dropdown.
  useEffect(() => {
    if (outputKindOverridden || !expression.trim()) return;
    const r = parseFormula(expression);
    if (!r.ok) return;
    const inferred = inferFormulaOutputKind(r.value);
    if (inferred !== outputKind) setOutputKind(inferred);
  }, [expression, outputKindOverridden, outputKind]);

  // Sync scroll mirror ↔ textarea
  const handleScroll = () => {
    if (taRef.current && mirrorRef.current) {
      mirrorRef.current.scrollTop = taRef.current.scrollTop;
      mirrorRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  // Bases (autres EntityTypes) via tRPC
  const { data: ipcTypes } = trpc.schemas.list.useQuery({ search: undefined });
  const otherBases = useMemo<EntityType[]>(
    () => (ipcTypes ?? []).map(ipcEntityTypeToCore),
    [ipcTypes],
  );

  const basesByName = useMemo(() => {
    const m = new Map<string, EntityType>();
    for (const b of otherBases) {
      if (b.name) m.set(b.name, b);
      if (b.plural) m.set(b.plural, b);
    }
    return m;
  }, [otherBases]);

  const basesById = useMemo(() => {
    const m = new Map<string, EntityType>();
    for (const b of [baseSafe, ...otherBases]) {
      if (b.id) m.set(b.id, b);
    }
    return m;
  }, [baseSafe, otherBases]);

  const lookupTables = useMemo<LookupTables>(() => ({
    baseNames: new Set(basesByName.keys()),
    fieldNames: new Set(baseSafe.fields.flatMap((f) => [f.name, f.id].filter(Boolean))),
    variableNames: new Set(effectiveVariables),
  }), [basesByName, baseSafe.fields, effectiveVariables]);

  // Tokenize
  const tokens = useMemo(() => tokenize(expression, lookupTables), [expression, lookupTables]);

  // Context-aware completion
  const ctx = useMemo(() => contextAtCursor(expression, cursor, basesByName, basesById, baseSafe), [expression, cursor, basesByName, basesById, baseSafe]);
  const allCompletions = useMemo(
    () => buildCompletions(ctx, baseSafe, otherBases, effectiveVariables),
    [ctx, baseSafe, otherBases, effectiveVariables],
  );
  const filtered = useMemo(() => {
    if (!ctx.prefix && ctx.mode === "free") return [];
    const lc = ctx.prefix.toLowerCase();
    if (!lc) return allCompletions.slice(0, 12);
    const scored = allCompletions
      .map((c) => ({ c, s: fuzzyScore(c.label, lc) }))
      .filter((x): x is { c: CompletionItem; s: number } => x.s !== null);
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, 12).map((x) => x.c);
  }, [allCompletions, ctx]);

  useEffect(() => { setSelectedIdx(0); }, [ctx.prefix, ctx.mode]);

  const parseInfo = useMemo(() => {
    if (!expression.trim()) return { ok: true as const };
    const r = parseFormula(expression);
    if (r.ok) return { ok: true as const };
    return { ok: false as const, message: r.error.message, offset: r.error.position.offset };
  }, [expression]);
  const parseError = parseInfo.ok ? null : parseInfo.message;
  const errorOffset = parseInfo.ok ? -1 : parseInfo.offset;

  // Type inféré + warnings type-aware (uniquement si parse OK).
  const inferredKind = useMemo<InferredKind>(() => {
    if (!expression.trim()) return "unknown";
    const r = parseFormula(expression);
    if (!r.ok) return "unknown";
    return inferAstKind(r.value, baseSafe);
  }, [expression, baseSafe]);
  const typeWarnings = useMemo<string[]>(() => {
    if (!expression.trim()) return [];
    const r = parseFormula(expression);
    if (!r.ok) return [];
    return analyseFormula(r.value, baseSafe);
  }, [expression, baseSafe]);

  const paramHint = useMemo(() => {
    const h = paramHintAtCursor(expression, cursor);
    if (!h) return null;
    const fn = FUNCTIONS.find((f) => f.name === h.name);
    if (!fn) return null;
    return { name: h.name, argIndex: h.argIndex, sig: fn.sig };
  }, [expression, cursor]);

  const applyCompletion = useCallback((comp: CompletionItem) => {
    const before = expression.slice(0, ctx.start);
    const after = expression.slice(ctx.end);
    const next = before + comp.insertText + after;
    const insertStart = ctx.start;
    const newCursor = insertStart + comp.insertText.length + (comp.cursorDelta ?? 0);
    setExpression(next);
    requestAnimationFrame(() => {
      if (!taRef.current) return;
      taRef.current.focus();
      // Si l'insertion contient un placeholder `<…>`, on le sélectionne d'abord
      const placeholder = /<([^>]+)>/.exec(comp.insertText);
      if (placeholder) {
        const pStart = insertStart + placeholder.index;
        const pEnd = pStart + placeholder[0].length;
        taRef.current.setSelectionRange(pStart, pEnd);
        setCursor(pStart);
      } else {
        taRef.current.setSelectionRange(newCursor, newCursor);
        setCursor(newCursor);
      }
    });
  }, [expression, ctx.start, ctx.end]);

  // Snippet : sélectionne le prochain `<placeholder>` à partir d'une position.
  const selectNextPlaceholder = useCallback((from: number): boolean => {
    if (!taRef.current) return false;
    const m = /<([^>]+)>/.exec(expression.slice(from));
    if (!m) return false;
    const start = from + m.index;
    const end = start + m[0].length;
    taRef.current.focus();
    taRef.current.setSelectionRange(start, end);
    setCursor(start);
    return true;
  }, [expression]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => (i + 1) % filtered.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => (i - 1 + filtered.length) % filtered.length); return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        const pick = filtered[selectedIdx];
        if (pick) applyCompletion(pick);
        return;
      }
    }
    if (e.key === "Escape" && onCancel) { e.preventDefault(); onCancel(); return; }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!parseError && onSubmit) onSubmit(expression, outputKind, display, outputFormat || undefined);
    }
    // Tab : navigation entre placeholders `<…>` quand autocomplete fermé
    if (e.key === "Tab" && filtered.length === 0) {
      const pos = taRef.current?.selectionStart ?? 0;
      if (selectNextPlaceholder(pos)) {
        e.preventDefault();
        return;
      }
    }
    // `.` declenche autocomplete sans avoir à taper après
    if (e.key === ".") {
      requestAnimationFrame(() => { if (taRef.current) setCursor(taRef.current.selectionStart); });
    }
    // `(` après `.where`/.Filter/etc → auto-insère `currentValue.`
    if (e.key === "(") {
      requestAnimationFrame(() => {
        if (!taRef.current) return;
        const ta = taRef.current;
        const pos = ta.selectionStart;
        // Match `.<method>(` juste avant le curseur
        const before = ta.value.slice(0, pos);
        const m = /\.(where|Filter|Map|Sort|Reduce|GroupBy|WhereBy)\($/.exec(before);
        if (!m) return;
        const insert = "currentValue.";
        const newVal = before + insert + ta.value.slice(pos);
        setExpression(newVal);
        const newPos = pos + insert.length;
        requestAnimationFrame(() => {
          if (taRef.current) {
            taRef.current.setSelectionRange(newPos, newPos);
            setCursor(newPos);
          }
        });
      });
    }
  };

  const syncCursor = () => {
    if (taRef.current) setCursor(taRef.current.selectionStart);
  };

  useEffect(() => {
    taRef.current?.focus();
    taRef.current?.setSelectionRange(expression.length, expression.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Force scroll resync after every render
  useLayoutEffect(() => { handleScroll(); });

  return (
    <div className="flex flex-col gap-2" style={inline ? undefined : { width: 380 }}>
      {!inline && (
        <p className="sn-eyebrow sn-eyebrow--compact">
          Formule de la colonne
        </p>
      )}

      {paramHint && (
        <div
          className="rounded px-2 py-1 font-mono text-[10px]"
          style={{
            backgroundColor: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          {highlightParam(paramHint.sig, paramHint.argIndex)}
        </div>
      )}

      <div className="relative">
        {/* Mirror coloré derrière le textarea */}
        <div
          ref={mirrorRef}
          aria-hidden
          className="absolute inset-0 pointer-events-none overflow-hidden rounded border"
          style={{
            borderColor: parseError ? "var(--destructive)" : "var(--border)",
            padding: "6px 8px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: "transparent",
            backgroundColor: "var(--surface-0)",
          }}
        >
          {tokens.map((t, i) => {
            const color = TOKEN_COLORS[t.kind];
            const isErr = errorOffset >= 0 && errorOffset >= t.start && errorOffset <= t.end;
            if (t.kind === "whitespace") return <span key={i}>{t.text}</span>;
            return (
              <span
                key={i}
                style={{
                  color: color ?? "var(--text-primary)",
                  fontWeight: t.kind === "fn" || t.kind === "base" ? 600 : 400,
                  ...(t.kind === "base" ? {
                    backgroundColor: "rgba(16,185,129,0.10)",
                    borderRadius: 2,
                    padding: "0 1px",
                  } : null),
                  ...(t.kind === "field" ? {
                    backgroundColor: "rgba(59,130,246,0.10)",
                    borderRadius: 2,
                    padding: "0 1px",
                  } : null),
                  ...(t.kind === "fn" ? {
                    backgroundColor: "rgba(139,92,246,0.08)",
                    borderRadius: 2,
                    padding: "0 1px",
                  } : null),
                  ...(t.kind === "variable" ? {
                    backgroundColor: "rgba(245,158,11,0.12)",
                    borderRadius: 2,
                    padding: "0 1px",
                    fontWeight: 600,
                  } : null),
                  ...(isErr ? {
                    textDecorationLine: "underline",
                    textDecorationStyle: "wavy",
                    textDecorationColor: "var(--destructive)",
                  } : null),
                }}
              >
                {t.text}
              </span>
            );
          })}
          {/* trailing newline workaround */}
          {"​"}
        </div>

        <textarea
          ref={taRef}
          value={expression}
          onChange={(e) => {
            breadcrumb("formula:edit");
            const next = e.target.value;
            setExpression(next);
            setCursor(e.target.selectionStart);
            onChange?.(next);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncCursor}
          onClick={syncCursor}
          onSelect={syncCursor}
          onScroll={handleScroll}
          rows={4}
          spellCheck={false}
          placeholder={placeholder ?? "Ex : Contact.where(currentValue.age == thisRow.age).count"}
          className="relative w-full resize-y rounded border"
          style={{
            borderColor: parseError ? "var(--destructive)" : "var(--border)",
            padding: "6px 8px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            backgroundColor: "transparent",
            color: "transparent",
            caretColor: "var(--text-primary)",
            outline: "none",
          }}
        />

        {filtered.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full mt-1 rounded border shadow-md"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-0)",
              zIndex: 10,
              maxHeight: 280,
              overflowY: "auto",
            }}
          >
            <ContextBanner ctx={ctx} />
            {filtered.map((c, i) => (
              <button
                key={c.kind + ":" + c.label + ":" + i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); applyCompletion(c); }}
                className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px]"
                style={{
                  backgroundColor: i === selectedIdx ? "var(--surface-2)" : "transparent",
                  color: "var(--text-primary)",
                }}
              >
                <KindBadge kind={c.kind} />
                <span className="font-mono">{c.label}</span>
                {c.detail && (
                  <span className="ml-auto truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {c.detail}
                  </span>
                )}
              </button>
            ))}
            <CompletionDocFooter item={filtered[selectedIdx]} />
          </div>
        )}
      </div>

      {parseError && (
        <p className="font-mono text-[10px]" style={{ color: "var(--destructive)" }}>
          {parseError}
        </p>
      )}

      {/* Badge type inféré + pretty-print */}
      {!parseError && expression.trim() && (
        <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
          <span
            className="rounded px-1.5 py-0.5 font-mono"
            style={{
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
            }}
            title="Type inféré de la sortie"
          >
            → {inferredKind}
          </span>
          <button
            type="button"
            onClick={() => {
              const p = prettyPrint(expression);
              setExpression(p);
              onChange?.(p);
            }}
            className="rounded px-1.5 py-0.5"
            style={{
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
              cursor: "pointer",
            }}
            title="Formater l'expression"
          >
            Formater
          </button>
        </div>
      )}

      {/* Warnings type-aware */}
      {typeWarnings.length > 0 && (
        <ul className="text-[10px] space-y-0.5" style={{ color: "var(--warning, #b45309)" }}>
          {typeWarnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {!inline && (
      <div className="flex items-center gap-2">
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Sortie</label>
        <select
          value={outputKind}
          onChange={(e) => { setOutputKind(e.target.value as FormulaOutputKind); setOutputKindOverridden(true); }}
          className="rounded border bg-[var(--surface-1)] px-1.5 py-1 text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          title={outputKindOverridden ? "Override manuel" : "Inféré depuis la formule"}
        >
          <option value="text">Texte</option>
          <option value="number">Nombre</option>
          <option value="date">Date</option>
          <option value="bool">Booléen</option>
        </select>
        {!outputKindOverridden && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>auto</span>
        )}
        {(outputKind === "number" || outputKind === "date") && (
          <select
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value)}
            className="rounded border bg-[var(--surface-1)] px-1.5 py-1 text-[11px]"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            {outputKind === "number" && (
              <>
                <option value="">Brut</option>
                <option value="decimals:0">0 décimale</option>
                <option value="decimals:2">2 décimales</option>
                <option value="percent">Pourcentage</option>
                <option value="currency:EUR">€ EUR</option>
                <option value="currency:USD">$ USD</option>
              </>
            )}
            {outputKind === "date" && (
              <>
                <option value="">Locale</option>
                <option value="date:YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="date:DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="date:YYYY-MM-DD HH:mm">YYYY-MM-DD HH:mm</option>
              </>
            )}
          </select>
        )}
        <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
          Tab/Entrée = autocomplète · Ctrl+Entrée = valider
        </span>
      </div>
      )}

      {/* Sélecteur de mode d'affichage (blocs vivants dans les notes) */}
      {showDisplaySelector && (
      <div className="flex items-center gap-2">
        <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>Affichage</label>
        <select
          value={display}
          onChange={(e) => setDisplay(e.target.value as FormulaDisplay)}
          className="rounded border bg-[var(--surface-1)] px-1.5 py-1 text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          title="Mode d'affichage du bloc dans la note"
        >
          <option value="value">Valeur</option>
          <option value="countdown">Compte à rebours</option>
          <option value="progress">Jauge</option>
          <option value="sparkline">Sparkline</option>
        </select>
      </div>
      )}

      {!inline && (
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => onCancel?.()}
          className="rounded px-2 py-1 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={11} className="inline" /> Annuler
        </button>
        <button
          type="button"
          disabled={!!parseError || !expression.trim()}
          onClick={() => onSubmit?.(expression, outputKind, display, outputFormat || undefined)}
          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium"
          style={{
            backgroundColor: "var(--btn-primary-bg)",
            color: "var(--btn-primary-fg)",
            opacity: parseError || !expression.trim() ? 0.5 : 1,
          }}
        >
          <Check size={11} /> Valider la formule
        </button>
      </div>
      )}
    </div>
  );
}

function ContextBanner({ ctx }: { ctx: ContextInfo }) {
  let label = "";
  if (ctx.mode === "member-of-base" && ctx.contextBase) label = `Champs et méthodes de ${ctx.contextBase.plural || ctx.contextBase.name}`;
  else if (ctx.mode === "member-of-row") {
    label = ctx.contextBase
      ? `Champs de ${ctx.contextBase.name || ctx.contextBase.plural} (currentValue)`
      : "Champs de la ligne courante";
  }
  else if (ctx.mode === "member-of-list") label = ctx.contextBase ? `Méthodes de liste · Champs de ${ctx.contextBase.name || ctx.contextBase.plural}` : "Méthodes de liste";
  else if (ctx.mode === "member-of-string") label = "Méthodes de chaîne";
  else if (ctx.mode === "member-of-number") label = "Méthodes de nombre";
  else if (ctx.mode === "member-of-date") label = "Méthodes de date";
  else if (ctx.mode === "member-of-bool") label = "Méthodes de booléen";
  else if (ctx.mode === "rhs-suggestion") label = "Valeurs suggérées";
  else label = "Fonctions, bases, champs";
  return (
    <div
      className="sn-eyebrow sn-eyebrow--compact px-2 py-1"
      style={{ backgroundColor: "var(--surface-1)",
        borderBottom: "1px solid var(--border-subtle)" }}
    >
      {label}
    </div>
  );
}

function CompletionDocFooter({ item }: { item: CompletionItem | undefined }) {
  if (!item) return null;
  const doc = item.kind === "function" || item.kind === "member" ? fnDoc(item.label) : null;
  if (!doc) return null;
  return (
    <div
      className="border-t px-2 py-1.5 text-[10px]"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
        color: "var(--text-secondary)",
      }}
    >
      <div>{doc.doc}</div>
      {doc.example && (
        <code
          className="mt-1 block font-mono"
          style={{ color: "var(--text-muted)", fontSize: 10 }}
        >
          {doc.example}
        </code>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: CompletionItem["kind"] }) {
  const palette: Record<CompletionItem["kind"], { bg: string; fg: string; label: string }> = {
    function: { bg: "#8B5CF6", fg: "#fff", label: "ƒ" },
    base: { bg: "#10B981", fg: "#fff", label: "B" },
    field: { bg: "#3B82F6", fg: "#fff", label: "#" },
    keyword: { bg: "#EAB308", fg: "#fff", label: "k" },
    member: { bg: "#A855F7", fg: "#fff", label: "." },
    variable: { bg: "#F59E0B", fg: "#fff", label: "$" },
  };
  const p = palette[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: 3,
        backgroundColor: p.bg,
        color: p.fg,
        fontSize: 9,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {p.label}
    </span>
  );
}
