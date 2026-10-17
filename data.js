'use strict';

/* Characteristics. Energy is not earned with XP — it is the average sleep of the last 7 entries. */
const STATS = {
  backend: { name: 'Backend', icon: 'brain', color: '#7c7cff' },
  body:    { name: 'Тело', icon: 'dumbbell', color: '#ef4444' },
  people:  { name: 'Люди', icon: 'users', color: '#f59e0b' },
  create:  { name: 'Создавать', icon: 'hammer', color: '#10b981' },
  novelty: { name: 'Новое', icon: 'sprout', color: '#06b6d4' },
  energy:  { name: 'Энергия', icon: 'battery', color: '#a3e635' },
};
const XP_STATS = ['backend', 'body', 'people', 'create', 'novelty'];
// The four life spheres from the weekly retro
const SPHERES = ['people', 'body', 'create', 'novelty'];

/* Activities you tick in the daily entry. xp = per time ticked, or per hour when timed. */
const DEFAULT_ACTIVITIES = [
  { id: 'work', name: 'Работа', icon: 'briefcase', stat: '', xp: 0, tag: 'работа', timed: false },
  { id: 'study', name: 'Учёба', icon: 'book-open', stat: 'backend', xp: 30, tag: 'учёба', timed: true },
  { id: 'gym', name: 'Зал', icon: 'dumbbell', stat: 'body', xp: 20, tag: 'gym', timed: false },
  { id: 'football', name: 'Футбол', icon: 'trophy', stat: 'people', xp: 20, tag: 'football', timed: false },
  { id: 'volleyball', name: 'Волейбол', icon: 'volleyball', stat: 'people', xp: 20, tag: 'volleyball', timed: false },
  { id: 'friends', name: 'Встреча с людьми', icon: 'users', stat: 'people', xp: 20, tag: 'люди', timed: false },
  { id: 'outside', name: 'Вышел из дома', icon: 'footprints', stat: 'body', xp: 10, tag: '', timed: false },
  { id: 'code', name: 'Писал свой код', icon: 'code', stat: 'create', xp: 25, tag: 'код', timed: false },
  { id: 'pet', name: 'Пет-проект', icon: 'rocket', stat: 'create', xp: 30, tag: 'петпроект', timed: false },
  { id: 'new', name: 'Что-то новое', icon: 'sparkles', stat: 'novelty', xp: 25, tag: 'новое', timed: false },
  { id: 'dota', name: 'Dota', icon: 'gamepad-2', stat: '', xp: 0, tag: 'dota', timed: true },
];

const LC_TOPICS = [
  ['two-pointers', 'Два указателя'], ['sliding-window', 'Sliding window'], ['hashmap', 'Хеш-таблицы'],
  ['stack', 'Стек'], ['binary-search', 'Бинарный поиск'], ['linked-list', 'Связные списки'],
  ['trees', 'Деревья'], ['graphs', 'Графы (BFS/DFS)'], ['heap', 'Куча'], ['backtracking', 'Backtracking'],
  ['dp', 'Динамика'], ['greedy', 'Жадные'], ['intervals', 'Интервалы'], ['strings', 'Строки'], ['other', 'Другое'],
];
const LC_XP = { E: 10, M: 20, H: 40 };

/* Roadmap to Middle Go Backend. Each node has 3 stars: studied / explained (Feynman) / applied.
   Algorithm nodes are starred automatically from LeetCode counts (1 / 5 / 15 solved). */
const TREE = [
  { id: 'go', name: 'Go', icon: 'code', nodes: [
    ['go-basics', 'Типы, слайсы, мапы'], ['go-iface', 'Интерфейсы и композиция'], ['go-errors', 'Ошибки и panic/recover'],
    ['go-goroutines', 'Горутины и каналы'], ['go-sync', 'sync, mutex, atomic'], ['go-context', 'context и отмена'],
    ['go-generics', 'Generics'], ['go-testing', 'Тесты и бенчмарки'], ['go-runtime', 'Планировщик, GC, память'],
    ['go-pprof', 'pprof и профилирование'], ['go-project', 'Структура проекта, модули'],
  ] },
  { id: 'sql', name: 'Базы данных', icon: 'database', nodes: [
    ['sql-basics', 'SQL, JOIN, агрегаты'], ['sql-index', 'Индексы (B-tree и др.)'], ['sql-tx', 'Транзакции и изоляция'],
    ['sql-mvcc', 'Блокировки и MVCC'], ['sql-explain', 'EXPLAIN и оптимизация'], ['sql-repl', 'Репликация и шардирование'],
    ['sql-migr', 'Миграции без даунтайма'], ['sql-nosql', 'NoSQL: когда и зачем'],
  ] },
  { id: 'redis', name: 'Redis', icon: 'zap', nodes: [
    ['redis-ds', 'Структуры данных'], ['redis-cache', 'Кэширование и инвалидация'], ['redis-locks', 'Распределённые локи'],
    ['redis-rate', 'Rate limiting'], ['redis-streams', 'Pub/Sub и Streams'], ['redis-persist', 'Персистентность и кластер'],
  ] },
  { id: 'mq', name: 'Kafka и очереди', icon: 'workflow', nodes: [
    ['mq-kafka', 'Топики, партиции, реплики'], ['mq-groups', 'Consumer groups и offset'], ['mq-delivery', 'Гарантии доставки'],
    ['mq-outbox', 'Transactional outbox'], ['mq-idem', 'Идемпотентность'], ['mq-rabbit', 'RabbitMQ vs Kafka'],
  ] },
  { id: 'api', name: 'API', icon: 'radio', nodes: [
    ['api-http', 'HTTP и REST'], ['api-grpc', 'gRPC и protobuf'], ['api-auth', 'Аутентификация: JWT, OAuth'],
    ['api-design', 'Пагинация, версии, ошибки'],
  ] },
  { id: 'arch', name: 'Архитектура', icon: 'layers', nodes: [
    ['arch-micro', 'Микросервисы vs монолит'], ['arch-saga', 'Saga и распределённые транзакции'],
    ['arch-cap', 'CAP и консистентность'], ['arch-resil', 'Retry, timeout, circuit breaker'],
    ['arch-clean', 'Чистая архитектура, DDD'],
  ] },
  { id: 'sd', name: 'System Design', icon: 'network', nodes: [
    ['sd-lb', 'Балансировка и масштабирование'], ['sd-cache', 'Кэш и CDN на уровне системы'],
    ['sd-geo', 'Геопоиск: geohash, «водители рядом»'], ['sd-taxi', 'Дизайн: сервис такси'],
    ['sd-ratelimiter', 'Дизайн: rate limiter'], ['sd-notify', 'Дизайн: уведомления'],
  ] },
  { id: 'infra', name: 'Инфраструктура', icon: 'container', nodes: [
    ['inf-docker', 'Docker'], ['inf-k8s', 'Kubernetes основы'], ['inf-ci', 'CI/CD'],
    ['inf-obs', 'Логи, метрики, трейсинг'], ['inf-net', 'Сети: TCP, DNS, TLS'], ['inf-linux', 'Linux для бэкендера'],
  ] },
  { id: 'algo', name: 'Алгоритмы', icon: 'cpu', auto: true, nodes: LC_TOPICS.filter(([id]) => id !== 'other').map(([id, n]) => ['lc-' + id, n]) },
];
const TREE_NODES = TREE.flatMap(b => b.nodes.map(([id, name]) => ({ id, name, branch: b.id, auto: !!b.auto })));

const DEFAULT_REWARDS = [
  { id: 'r1', name: 'Вечер Dota без угрызений', icon: 'gamepad-2', cost: 150 },
  { id: 'r2', name: 'Вкусный ужин вне дома', icon: 'utensils', cost: 400 },
  { id: 'r3', name: 'Ленивый выходной', icon: 'bed', cost: 600 },
  { id: 'r4', name: 'Новая игра или гаджет', icon: 'gift', cost: 2000 },
];

const GOAL_TYPES = {
  topic: { name: 'Тема', icon: 'book-open', weight: 30 },
  lc: { name: 'LeetCode', icon: 'code', weight: 40 },
  feynman: { name: 'Фейнман', icon: 'lightbulb', weight: 20 },
  life: { name: 'Жизнь', icon: 'sprout', weight: 10 },
};
