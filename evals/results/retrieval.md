# Retrieval eval

17 questions with known source passages, over 62 passages from 14 documents.

| Mode | Recall@1 | Recall@3 | Recall@5 | MRR |
| --- | --- | --- | --- | --- |
| `bm25-naive` | 59% | 85% | 91% | 0.767 |
| `bm25` | 79% | 94% | 94% | 0.882 |
| `dense` | 68% | 74% | 94% | 0.776 |
| `hybrid` | 71% | 94% | 100% | 0.838 |

## Misses at k=5

- `bm25-naive` q06 "לאיזה אורך כדאי לחתוך כל קטע כשמכינים מסמכים למאגר?": wanted rag#3; got rag#5, community-tips#4, mcp#2, search#2, hallucinations#3
- `bm25-naive` q17 "מה זו הזרקת פרומפט, ואיך ההרשאות שנותנים לסוכן קשורות לזה?": wanted prompt-injection#1, agents#4; got prompt-injection#1, prompt-injection#4, prompt-injection#3, prompt-injection#2, prompting#1
- `bm25` q01 "למה הצ'אט לפעמים ממציא עובדות שנשמעות לגמרי נכונות?": wanted hallucinations#2; got hallucinations#1, evals#1, agents#1, llm-basics#1, evals#5
- `dense` q15 "המחירון שלנו מתעדכן כל שבוע. כדאי לאמן את המודל עליו?": wanted fine-tuning#3; got llm-basics#4, fine-tuning#4, cost-speed#2, cost-speed#1, privacy#3
