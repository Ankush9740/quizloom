with quiz as (
  insert into public.quizzes(title) values ('Campus Curiosity Cup') returning id
), q as (
  insert into public.questions(quiz_id, prompt, position, time_limit_seconds)
  select quiz.id, v.prompt, v.position, v.seconds from quiz cross join (values
    ('Which planet has the shortest day?', 0, 20),
    ('What does HTTP stand for?', 1, 20),
    ('Who wrote The Discovery of India?', 2, 25),
    ('Which element has the symbol Fe?', 3, 15),
    ('In which year did the first iPhone launch?', 4, 20)
  ) v(prompt, position, seconds) returning id, position
)
insert into public.question_options(question_id, text, position, is_correct)
select q.id, o.text, o.position, o.correct from q join (values
  (0, 'Jupiter', 0, true), (0, 'Mars', 1, false), (0, 'Mercury', 2, false), (0, 'Saturn', 3, false),
  (1, 'Hypertext Transfer Protocol', 0, true), (1, 'High Transfer Text Process', 1, false), (1, 'Hosted Terminal Transfer Program', 2, false), (1, 'Hyperlink Text Type Protocol', 3, false),
  (2, 'Jawaharlal Nehru', 0, true), (2, 'Rabindranath Tagore', 1, false), (2, 'B. R. Ambedkar', 2, false), (2, 'R. K. Narayan', 3, false),
  (3, 'Fluorine', 0, false), (3, 'Iron', 1, true), (3, 'Francium', 2, false), (3, 'Fermium', 3, false),
  (4, '2005', 0, false), (4, '2007', 1, true), (4, '2009', 2, false), (4, '2011', 3, false)
) o(question_position, text, position, correct) on o.question_position = q.position;
