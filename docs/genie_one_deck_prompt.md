Create a 12-slide deck to accompany a live demo of our "Product changeover intelligence" app. Audience: two stakeholders from a retail customer, an executive sponsor (cares about margin, working capital, risk) and a domain owner (category / master-data manager; cares about team hours, data quality, forecast accuracy, on-shelf availability). Lead with the business outcome, quantify impact in the buyer's KPIs, and frame value separately for each of them. Plain business language, short headlines that state the takeaway, no jargon on the first 6 slides. Add speaker notes to every slide (what to say in 30-60 seconds, and what to show in the app where relevant).

Use only these tables in patricia_aws_serverless_catalog, and only numbers that come from them:
- gold.value_model_levers: business value per lever (lever, buyer_kpi, primary_audience, kpi_effect_base, formula, low_eur, base_eur, high_eur). Headline total = SUM(base_eur); range = SUM(low_eur) to SUM(high_eur).
- gold.value_model_assumptions: the assumptions behind it (base value, unit, note).
- gold.sales_forecast_accuracy: holdout accuracy of the two forecast models (wape_pct, coverage_pct, bias_pct).
- gold.changeover_impact: measured effect of each GTIN changeover on weekly unit sales (status = 'measured': effect_pct, ci_low, ci_high, significant, controls_fit).
Every value figure is an ILLUSTRATIVE ESTIMATE for a mid-size grocery/drugstore retailer with 4,000 changeovers a year, not a measured result; label it "estimated" wherever it appears. Sales data in the demo is synthetic; say so on the proof slide.

Slides:
1. Title: "Turn vendor changeovers into margin". Subtitle with the estimated annual value (SUM(base_eur), rounded to EUR 0.7M) and "for a retailer with 4,000 changeovers a year".
2. Executive summary: the estimated total, the low-high range, and three outcomes: fewer costly data errors, lower safety stock, better changeover decisions. One big number.
3. The problem today (no chart): vendor documents in PDFs and many languages are keyed by hand; a wrong GTIN or date causes failed scans and empty shelves; sales history breaks when a GTIN changes; nobody can tell whether a formula or packaging change helped or hurt sales.
4. Impact in your KPIs: table of lever, buyer_kpi, kpi_effect_base, base_eur from gold.value_model_levers, plus a horizontal bar chart of base_eur by lever.
5. For the executive sponsor: only levers where primary_audience = 'Executive sponsor'; show their base_eur, the working capital freed (from kpi_effect_base of "Lower safety stock"), and the total range as risk-adjusted upside.
6. For the domain owner: only levers where primary_audience = 'Domain owner'; show hours freed and errors stopped, and describe their new workflow: upload, AI extracts, automatic checks, review and publish, forecast per product, measured changeover effects, ask Genie instead of requesting reports.
7. Proof from the demo: bar chart of wape_pct by model from gold.sales_forecast_accuracy (lower is better), and a chart of effect_pct with ci_low to ci_high per measured changeover from gold.changeover_impact. Note that the data is synthetic with planted effects, and that the analysis recovered them.
8. What you'll see in the demo: four steps matching the app pages (Upload & review, Sales forecast, Changeover impact, Genie insights), each with "what to look for".
9. How it works: one-line data flow, raw documents and sales -> Lakeflow -> Unity Catalog -> Lakebase -> Gen AI and ML -> Genie Agent -> business app; one sentence per stage on why it matters to the business (governed, fast for many users, explainable).
10. What drives the estimate: table of the base assumptions with unit and note from gold.value_model_assumptions, highlighting the two biggest levers (data errors and changeover decisions are about 70% of the total) and the low/base/high totals.
11. Why this approach: 4 key decisions in business terms: human review before publishing, two forecast models compared on accuracy, changeover effects measured against unchanged products (not before/after), Genie on governed tables showing its SQL.
12. Proposed next step: a pilot on one category with the customer's own data, replacing the assumptions with their numbers; success criteria tied to the KPIs on slide 4 (error rate, hours, forecast WAPE, measured changeover effects). Label it "proposed".

Style: clean, white background, dark navy text, one red accent colour; one idea per slide; large numbers for KPIs.
