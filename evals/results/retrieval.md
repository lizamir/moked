# Retrieval eval

8 questions with known source passages, over 40 passages from 11 documents.

| Mode | Recall@1 | Recall@3 | Recall@5 | MRR |
| --- | --- | --- | --- | --- |
| `bm25-naive` | 38% | 75% | 88% | 0.573 |
| `bm25` | 44% | 88% | 88% | 0.667 |
| `dense` | 94% | 100% | 100% | 1.000 |
| `hybrid` | 81% | 100% | 100% | 0.938 |

## Misses at k=5

- `bm25-naive` s09 "קראתי באינטרנט שחיסון כלבת מספיק כדי להשאיר כלב בפנסיון. זה נכון אצלכם?": wanted vaccines#2; got vaccines#1, boarding#4, health-safety#3, health-safety#2, vaccines#4
- `bm25` s02 "קבעתי תור למחר ואני צריכה לבטל. זה יעלה לי משהו?": wanted cancellation#1; got cancellation#3, payments#3, booking#1, health-safety#3, booking#2
