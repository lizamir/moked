# Retrieval eval

17 questions with known source passages, over 53 passages from 13 documents.

| Mode | Recall@1 | Recall@3 | Recall@5 | MRR |
| --- | --- | --- | --- | --- |
| `bm25-naive` | 62% | 76% | 82% | 0.725 |
| `bm25` | 59% | 91% | 94% | 0.765 |
| `dense` | 71% | 85% | 91% | 0.816 |
| `hybrid` | 71% | 91% | 91% | 0.853 |

## Misses at k=5

- `bm25-naive` q06 "מה המחיר של הודעת טקסט אחרי שנגמרה החבילה?": wanted reminders#2; got cancellation-refunds#4, troubleshooting#2, onboarding#1, payments#2, team-permissions#4
- `bm25-naive` q08 "כל כמה זמן היומן של גוגל מתעדכן?": wanted calendar-sync#2; got troubleshooting#5, client-booking#4, team-permissions#1, support#3, api#2
- `bm25-naive` q11 "כמה אתם לוקחים על כל תשלום שעובר דרך המערכת?": wanted payments#1; got support#4, community-tips#1, api#2, payments#4, team-permissions#2
- `bm25` q08 "כל כמה זמן היומן של גוגל מתעדכן?": wanted calendar-sync#2; got troubleshooting#5, team-permissions#1, calendar-sync#4, calendar-sync#1, troubleshooting#1
- `dense` q08 "כל כמה זמן היומן של גוגל מתעדכן?": wanted calendar-sync#2; got cancellation-refunds#4, security-privacy#2, calendar-sync#1, pricing#1, reminders#4
- `dense` q17 "קיבלתי שגיאה E-2040. מה הבעיה, וכמה זמן לוקח עד שזה מסתדר?": wanted troubleshooting#2, reminders#3; got troubleshooting#2, troubleshooting#4, troubleshooting#5, troubleshooting#3, troubleshooting#1
- `hybrid` q08 "כל כמה זמן היומן של גוגל מתעדכן?": wanted calendar-sync#2; got calendar-sync#1, troubleshooting#5, pricing#1, support#2, api#1
- `hybrid` q17 "קיבלתי שגיאה E-2040. מה הבעיה, וכמה זמן לוקח עד שזה מסתדר?": wanted troubleshooting#2, reminders#3; got troubleshooting#2, troubleshooting#5, troubleshooting#4, troubleshooting#1, troubleshooting#3
