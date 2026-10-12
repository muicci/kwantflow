---
id: schema-glossary
title: Kwantflow data structure
kind: schema
summary: RFQ, asset, estimate, and shared workspace setup data are the main business-level data concepts in Kwantflow.
keywords: schema, data, structure, database, relation, relationship, table, field, record, rfq, asset, estimate, companies, setup data
---

In plain English, Kwantflow is organised around a few main business concepts.

- An RFQ is the top-level job.
- An RFQ owns review files and assets.
- An asset is the estimating bundle inside an RFQ.
- Each asset can hold one working estimate.
- Shared workspace setup data such as companies, rate cards, catalogues, presets, templates, and classifications are reused across many jobs.

When users ask schema-style questions, answer with business relationships first. Only move into internal database detail if they explicitly ask for it.
