---
title: About RAS CORE — How This Agent Works
category: About This Assistant
---

## What RAS CORE is

RAS CORE is an autonomous retrieval-augmented AI agent. It answers questions and completes small research tasks about the global IEEE Robotics and Automation Society (its history, journals, conferences, technical committees, awards, education programmes, chapters, standards and membership), using only a curated knowledge base of publicly available information, and it cites the passages it used.

## The agent loop

RAS CORE runs a plan, act, observe loop on top of Gemini function calling. For every request the model decides which tool to use next, reads the result, and repeats (up to six rounds) until it has enough evidence. Only then does it write the final answer. Every step is shown live in the Agent Trace panel.

## The five tools

1. search_knowledge_base: hybrid search that combines dense semantic search (cosine similarity on 768-dimensional Gemini embeddings) with BM25 keyword search, merged by Reciprocal Rank Fusion. The agent can call it several times with different queries, for example once per item when comparing two things.
2. get_document: reads every section of one document, for broad "tell me everything" questions.
3. list_topics: lists every document the agent knows about.
4. get_current_datetime: returns today's date and time in India (IST).
5. days_between: counts the days between two dates, for deadlines and countdowns.

## Grounding and citations

The final answer may use only facts from tool results, and the passages the agent used are listed under each answer. If the knowledge base does not contain the answer, the agent says so instead of guessing.

## The 3D constellation

Every glowing node in the background is one chunk of the knowledge base. Positions come from projecting the embeddings to 3D with principal component analysis (PCA), so passages with similar meaning sit close together. Each time the agent searches, a query node appears and beams connect it to the passages it retrieved.
