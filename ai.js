'use strict';

/* OpenAI calls straight from the phone. The key lives only in this device's storage
   (never in the code or in backups). Every call is started by an explicit button press. */
const AI = {
  get key() { try { return localStorage.getItem('quest.openaiKey') || ''; } catch (e) { return ''; } },
  set key(v) { try { v ? localStorage.setItem('quest.openaiKey', v) : localStorage.removeItem('quest.openaiKey'); } catch (e) { /* ignore */ } },
  get model() { try { return localStorage.getItem('quest.openaiModel') || 'gpt-4o-mini'; } catch (e) { return 'gpt-4o-mini'; } },
  set model(v) { try { localStorage.setItem('quest.openaiModel', v || 'gpt-4o-mini'); } catch (e) { /* ignore */ } },
  get ready() { return !!this.key; },

  async json(system, user, { temperature = 0.4 } = {}) {
    if (!this.key) throw new Error('Добавьте ключ OpenAI в настройках');
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.key}` },
        body: JSON.stringify({
          model: this.model,
          temperature,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
    } catch (e) {
      throw new Error('Нет связи с OpenAI — проверьте интернет');
    }
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      if (res.status === 401) throw new Error('Ключ OpenAI не подходит — проверьте его в настройках');
      if (res.status === 429) throw new Error('Лимит OpenAI исчерпан или слишком много запросов');
      if (res.status === 404) throw new Error(`Модель «${this.model}» недоступна — смените её в настройках`);
      throw new Error(`Ошибка OpenAI (${res.status}) ${msg}`.trim());
    }
    const data = await res.json();
    try { return JSON.parse(data.choices[0].message.content); }
    catch (e) { throw new Error('ИИ ответил в неожиданном формате, попробуйте ещё раз'); }
  },

  /* Free-form (dictated) story of the day → structured entry */
  parseDay(text, activities) {
    const acts = activities.map(a => `${a.id}: ${a.name}${a.timed ? ' (с минутами)' : ''}`).join('\n');
    return this.json(
      `Ты разбираешь короткий рассказ о дне на русском и раскладываешь его по полям дневника. Отвечай только JSON:
{"rating": число 1-10 или null, "sleep": часы сна числом или null, "bedBefore": true если лёг до 00:30 / false если позже / null если неясно,
 "activities": [id занятий из списка], "minutes": {"id": минуты} только для занятий с минутами,
 "studied": "что изучал, коротко" или "", "pleasant": "что было приятно" или "", "annoying": "что раздражало" или ""}
Список занятий (id: название):
${acts}
Не выдумывай: если чего-то нет в рассказе — null или пустая строка. Оценку ставь, только если человек её назвал или она очевидна по тону. Пиши поля от первого лица, коротко, в стиле личного дневника.`,
      text);
  },

  /* Feynman post → interviewer critique + follow-up questions */
  examStart(post) {
    return this.json(
      `Ты — строгий, но доброжелательный интервьюер на позицию Middle Go Backend Engineer в inDrive.
Кандидат объясняет тему своими словами (техника Фейнмана). Найди ошибки, неточности и важные пробелы, которые спросили бы на собеседовании.
Отвечай только JSON:
{"score": оценка объяснения 0-10, "good": "что объяснено хорошо (1-2 предложения)",
 "issues": ["конкретная неточность или пробел", ... не больше 4],
 "questions": ["уточняющий вопрос, как на реальном собесе", ... ровно 3, от простого к сложному]}
Пиши по-русски, коротко и по делу.`,
      postText(post));
  },

  examFinish(post, qa) {
    return this.json(
      `Ты — интервьюер на позицию Middle Go Backend Engineer в inDrive. Ты задал кандидату уточняющие вопросы по его объяснению темы, теперь оцени ответы.
Отвечай только JSON:
{"score": итоговая оценка 0-10 за объяснение и ответы вместе, "passed": true если уровень middle (обычно score >= 7),
 "answers": [{"verdict": "верно" | "частично" | "неверно", "comment": "чего не хватило и как ответил бы сильный кандидат, 1-3 предложения"}, ... по одному на вопрос],
 "summary": "общий вывод и что подтянуть, 2-3 предложения"}
Пустой ответ — "неверно". Пиши по-русски.`,
      `${postText(post)}\n\nВопросы и ответы кандидата:\n${qa.map((x, i) => `${i + 1}. ${x.q}\nОтвет: ${x.a || '(нет ответа)'}`).join('\n\n')}`);
  },

  /* Weekly retro coach */
  retro(ctx) {
    return this.json(
      `Ты — коуч, который помогает разработчику провести ретро недели. Цель человека: стать Middle Go Backend Engineer в inDrive к ${ctx.deadline}.
Он работает спринтами по неделе, ведёт дневник (оценка дня, сон, занятия) и решает LeetCode.
Проанализируй неделю по фактам: что мешало, что сработало, закономерности (сон, выход из дома, зал, Dota, время решения задач).
Предложи реалистичный план следующего спринта: учитывай, сколько он реально закрывает в прошлых спринтах — лучше чуть меньше, но на 100%.
Отвечай только JSON:
{"hindered": "что мешало, 1-2 предложения", "worked": "что сработало, 1-2 предложения", "conclusion": "вывод и одно конкретное правило на следующую неделю",
 "plan": [{"type": "topic" | "lc" | "feynman" | "life", "text": "формулировка цели", "target": число задач только для lc}, ... 3-5 целей]}
Пиши по-русски, от первого лица (как будто он сам пишет ретро), коротко, без мотивационной воды.`,
      JSON.stringify(ctx, null, 1));
  },
};

function postText(p) {
  return [`Тема: ${p.topic}`, p.problem && `Проблема: ${p.problem}`, p.solution && `Решение: ${p.solution}`,
    p.nuance && `Нюанс: ${p.nuance}`, p.where && `Где видел: ${p.where}`, p.question && `Вопрос на собесе: ${p.question}`]
    .filter(Boolean).join('\n');
}
