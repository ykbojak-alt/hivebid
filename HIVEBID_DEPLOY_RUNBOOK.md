# HIVEBID deployment runbook

Дата сверки: 2026-11-06. Цель — воспроизводимый локальный прогон и отдельная, owner-gated дорожка NEAR testnet. Никаких testnet-транзакций в рамках этого документа не выполнялось.

## Статус и разрешение на запуск

| Метка | Что подтверждено | Что это означает |
|---|---|---|
| `sandbox-verified` — исторический результат #403 | 30/30 шагов `demo-rehearsal-403.js` прошли на локальном `near-sandbox` 2.14.0-rc.5, protocol 88; `prepare_wasm` прошёл для Wasmtime и NearVm. | Это локальный sandbox на параметрах protocol 88, не публичный testnet и не доказательство текущего кандидата. |
| `CURRENT CANDIDATE: HOLD` | В checkout изменены `src/lib.rs` и WASM. #377 установил, что pin 463,640 B / md5 `d9e0…` не воспроизводится из текущего или HEAD-исходника и происходит от отсутствующего в Git исходника. | Сначала зафиксировать owner-approved `lib.rs`, пересобрать WASM из него и проверить пару. Старый pin не деплоить. |
| `testnet-pending` | Публичного testnet deploy/tx в проверенных материалах нет; аккаунты, доступ и owner approval не подтверждены этим runbook. | Любая write-команда ниже — будущая инструкция, запускать только после прохождения всех preflight-гейтов и явного решения владельца. |

Обозначение «protocol 88» в #403 — версия конфигурации локального sandbox, совместимая с testnet wasm-фичами; локальный sandbox от этого не становится testnet. Не использовать формулировки «задеплоено на testnet» или «проверено на реальном чейне» без отдельного факта транзакции.

## 0. Выбрать одну CLI-дорожку

Основной рецепт ниже использует **near-cli 4.0.13** и `deploy-testnet-nearcli.sh`. Не смешивать его с `deploy-testnet.sh`: последний использует синтаксис **near-cli-rs**, команды и флаги у двух CLI разные.

Все команды предназначены для Bash на Sage-pl в корне checkout `/root/nexus`. `deploy-testnet-nearcli.sh` требует Bash и GNU `date` (`date +%s%3N`); не запускать из `sh`, PowerShell или cmd.

## 1. Собрать и закрепить согласованную пару source + WASM

Текущий checkout находится на HOLD, пока исходник и артефакт не приведены к одной owner-approved ревизии. Из корня репозитория после согласования исходника:

```bash
cd /root/nexus/contracts/hivebid_market
AWS_LC_SYS_NO_ASM=1 cargo test --lib
AWS_LC_SYS_NO_ASM=1 cargo build --target wasm32-unknown-unknown --release
install -m 0644 target/wasm32-unknown-unknown/release/hivebid_market.wasm wasm/hivebid_market.wasm
cmp target/wasm32-unknown-unknown/release/hivebid_market.wasm wasm/hivebid_market.wasm
AWS_LC_SYS_NO_ASM=1 cargo test --test prepare_wasm -- --nocapture
sha256sum src/lib.rs wasm/hivebid_market.wasm
```

`prepare_wasm` проверяет подготовку артефакта на локальной конфигурации testnet protocol 88; он не подключается к RPC. До deploy владелец должен проверить diff исходника, точный SHA-256 собранного WASM и включить обе стороны пары в один review/commit. Не принимать размер или md5 старого pin за доказательство происхождения.

## 2. Воспроизвести локальную sandbox-проверку

Это отдельная локальная проверка без testnet-ключей и без публичных транзакций. Указать **каталог**, внутри которого лежит `near-sandbox`:

```bash
cd /root/nexus/contracts/hivebid_market/integration
HIVEBID_WASM=../wasm/hivebid_market.wasm \
NEAR_SANDBOX_BIN_PATH=/root/sandbox-p88 \
NEAR_SANDBOX_BINARY_PATH=/root/sandbox-p88 \
node demo-rehearsal-403.js
```

Ожидаемый итог при проверенном кандидате — 30/30 и `DEMO REHEARSAL #403: PASS`. Успех повторить на **точной** паре из шага 1; исторические 30/30 с прежним pin не закрывают этот gate.

Ловушка из SPARK #403: `NEAR_SANDBOX_BINARY_PATH` — каталог, не путь к файлу `near-sandbox`. Неверное значение или отсутствующий каталог молча переключает near-workspaces на npm-default (neard 2.6.2 / protocol 77), где wasm с bulk-memory не проходит prepare. `NEAR_SANDBOX_BIN_PATH` подавляет установку/подстановку default в `~/.near/sandbox`; обе переменные должны указывать на совместимый каталог. В примере `demo-rehearsal-403.js` оставлен старый ошибочный пример с `.../near-sandbox` в `BINARY_PATH` — использовать исправленную команду выше; скрипт здесь не редактировался.

На Roy1 без AVX2 современный sandbox может завершиться SIGILL; это ограничение CPU. Использовать Sage-pl/совместимую машину. Protocol-77 fallback — не контрактный дефект, а неподходящая sandbox-сборка.

## 2a. Core API auth — обязательное условие для demo-инфры (HERETIC #438)

Демо-оркестратор и NEWF ходят в nexus-core API. При любом **non-loopback**
bind (`--host` ≠ 127.0.0.1/localhost/::1) `NEXUS_CORE_TOKEN` **обязателен** —
`run_server` отказывается стартовать без него (открытый RCE-контур
`/api/core/exec|run|file/*`). Токен передаётся заголовком `X-Nexus-Key`.
Дополнительно `/api/core/machines/*` мутации требуют токен **всегда**
(включая loopback) — см. `docs/NEXUS_CORE_SPEC.md` §«Аутентификация core API».

## 3. Testnet preflight — только чтение

Перед подготовкой аккаунтов владелец выбирает и подтверждает **существующие** testnet-аккаунты. Не полагаться на шаблонные значения `hivebid.$NS.testnet`, `manager.$NS.testnet`, `agent.$NS.testnet`: отчёт #376 зафиксировал, что значения по умолчанию не существуют. В Bash заменить значения в кавычках на выданные владельцем account IDs:

```bash
cd /root/nexus/contracts/hivebid_market
export MKT='<existing-contract-account.testnet>'
export MGR='<owner-manager-account.testnet>'
export AGT='<agent-account.testnet>'
export HIVEBID_WASM="$(pwd)/wasm/hivebid_market.wasm"
export LOT="hb-smoke-$(date +%s)"
near --version
 test -s "$HIVEBID_WASM"
sha256sum "$HIVEBID_WASM"
near state "$MKT" --networkId testnet
near state "$MGR" --networkId testnet
near state "$AGT" --networkId testnet
```

Продолжать только если CLI показывает ожидаемый `4.0.13`, все аккаунты существуют, локальные credentials доступны владельцу, балансы покрывают все выбранные операции, а SHA-256 совпадает с owner-approved артефактом. Не печатать, не копировать и не прикладывать содержимое credential-файлов. Балансы из заметок 2026-11-05 — лишь ориентир: для полного `smoke` + `edge` тогда оценивалось ≥110 N у MGR, 10 N stake у AGT плюс gas, а MKT требовал deploy/storage; перед каждым запуском перепроверить фактические балансы и стоимость.

Проверить, что MKT действительно создан, но ещё не содержит контракт: `near state` должен показать пустой `code_hash` (`111…111`). Затем выполнить view:

```bash
near view "$MKT" get_escrow --args '{}' --networkId testnet
```

Для чистого аккаунта допустимо только ожидаемое отсутствие кода контракта. Если аккаунт не найден, RPC недоступен, ответ неоднозначен или `get_escrow` успешно вернул состояние — **ABORT**. Ошибка сети не доказывает, что аккаунт пуст.

Планировщик ниже не отправляет транзакции, но выводит значения конфигурации и метаданные найденных credential-файлов; не сохранять его полный вывод в публичный артефакт:

```bash
cd /root/nexus/contracts/hivebid_market/integration
MKT="$MKT" MGR="$MGR" AGT="$AGT" LOT="$LOT" node testnet-smoke.js --plan
```

`--plan` — расписание, не testnet-проверка. `--run` — наоборот, реальные read-only RPC `query/view`, без подписания и транзакций.

## 4. Testnet deploy — owner-gated write-шаги

Запускать только после шагов 1–3, owner approval, выбора свежего MKT-аккаунта и согласования точного SHA-256. Ниже — основной near-cli 4.0.13 lane из `deploy-testnet-nearcli.sh`.

```bash
cd /root/nexus/contracts/hivebid_market
./deploy-testnet-nearcli.sh deploy
```

На чистом аккаунте скрипт исполняет `near deploy "$MKT" "$WASM" --networkId testnet --force`, затем `near call "$MKT" new "{\"owner_id\":\"$MGR\"}" --useAccount "$MKT" --gas 30000000000000 --deposit 0 --networkId testnet`. WASM — **позиционный аргумент** к `near deploy`; `--wasmFile` не заменяет его в near-cli 4.0.13.

**Deploy-script limitation:** встроенный выбор ветки проверяет `get_escrow`, подавляя stderr; любой сбой view ведёт в ветку deploy + `new`. Поэтому не запускать его при нестабильном RPC и не считать эту проверку достаточной для доказательства чистого аккаунта: шаг 3 выполняется отдельно и непосредственно перед запуском. Любая потеря/неоднозначность ответа перед записью — STOP.

Скрипт увидит существующий инициализированный контракт и потребует `CONFIRM_UPGRADE=1`; эта переменная только отключает повторный `new`, она **не является миграцией и не доказывает совместимость layout**. В `lib.rs` нет migration hook. На существующем аккаунте upgrade запрещён без отдельного owner-approved плана совместимости состояния; не запускать эту команду как «повтор деплоя».

После deploy проверить чтением:

```bash
near state "$MKT" --networkId testnet
near view "$MKT" get_escrow --args '{}' --networkId testnet
```

Если deployment receipt или транзакционный статус неясен, получить hash из CLI и сверить `near tx-status <tx-hash> "$MKT" --networkId testnet`; не повторять deploy или `new` наугад.

## 5. Happy-path smoke и edge-path

Только после подтверждённого deploy/init. `LOT` должен быть новым и уникальным; smoke блокирует bid-окно примерно на 5 минут, затем проходит award/work/accept:

```bash
cd /root/nexus/contracts/hivebid_market
LOT="$LOT" ./deploy-testnet-nearcli.sh smoke
```

Скрипт регистрирует AGT со stake 10 N, создаёт задачу с бюджетом 50 N, подаёт bid 30 N, ждёт `BID + 15s`, затем закрывает bidding, выдаёт award, сдаёт и принимает работу. Перед запуском убедиться, что у MGR есть бюджет на `smoke` и будущий `edge`, у AGT — stake и gas.

Edge-сценарий создаёт лот с фиксированным ID `edge-1`, ждёт `BID + 15s` и `work_deadline + 15s`, затем вызывает `mark_no_show`:

```bash
./deploy-testnet-nearcli.sh edge
```

Запускать `edge` максимум один раз на данном экземпляре контракта: повтор столкнётся с `lot_id already exists`. Если нужна новая репетиция — согласовать отдельный свежий аккаунт/контракт и повторить весь preflight; не удалять аккаунт ради перезапуска.

`wait_ms <target_ms>` принимает **абсолютный epoch timestamp в миллисекундах**, не длительность. Функция ждёт с шагом 2 секунды; margins уже заложены как `BID + 15_000` и `WD + 15_000`. Не заменять это слепым `sleep 305/125/400`. `eta_ms` в sandbox-коде должен быть строго меньше `work_deadline` (`WD-1000`), равенство отклоняется.

### u128 и повторы — не переносить семантику между CLI

SPARK подтвердил у **near-workspaces**: `account.call()` сериализует BN/u128 в JSON-строку, тогда как `submit_bid.price` требует bare JSON integer. В `demo-rehearsal-403.js` это обходит `callRaw()` с ручным JSON и обязательной проверкой `out.status` — `callRaw()` сам не бросает при `Failure`.

Это подтверждение относится к JS `near-workspaces`, а не автоматически к shell `near-cli`. `deploy-testnet-nearcli.sh` сейчас посылает `price` строкой. Публичный testnet smoke этой конкретной сериализации в материалах не подтверждён: перед первой ставкой проверить её отдельным согласованным тестом; при deserialization/trap — ABORT и сверить фактический статус лота, не повторять `create_task`/ставку вслепую. Не вставлять `callRaw()` как замену `near call`.

`call_retry()` в shell-скрипте делает до 5 повторов с паузой 10 секунд и применяется к `close_bidding`/`mark_no_show`; он не классифицирует причину ошибки. При неоднозначном результате транзакции остановить операторский прогон и сначала сверить статус/receipt read-only. Не повторять `create_task`: если транзакция могла пройти, повторный lot ID не идемпотентен.

## 6. Post-deploy verification — read-only

После smoke и edge, либо после согласованного только-smoke сценария, проверить основные views:

```bash
near view "$MKT" get_lot --args "{\"lot_id\":\"$LOT\"}" --networkId testnet
near view "$MKT" get_escrow --args '{}' --networkId testnet
near view "$MKT" get_agent --args "{\"account\":\"$AGT\"}" --networkId testnet
cd /root/nexus/contracts/hivebid_market/integration
MKT="$MKT" MGR="$MGR" AGT="$AGT" LOT="$LOT" EXPECT_LOT=1 node testnet-smoke.js --run
```

`testnet-smoke.js --run` делает только read-only RPC queries: точные u128, raw storage/Borsh и инварианты I-A…I-G. Ожидается строка `=== ИТОГ: N/N проверок OK ===`; любой FAIL — остановиться, сохранить tx hashes/receipt и передать владельцу, не ослаблять инвариант. Сохранять hash и explorer URL только из реального CLI receipt/chain lookup; не конструировать ссылку или заявлять tx до появления подтверждённой транзакции.

## 7. ABORT-условия и восстановление

| Условие | Действие |
|---|---|
| Текущая пара `src/lib.rs`/WASM не пересобрана из одного owner-approved состояния; hash не совпал; deploy script остаётся unreviewed/untracked. | **ABORT до любой транзакции.** Пересобрать артефакт и провести source+WASM как одну review-пару; подтвердить статус скриптов. |
| Непонятно, свежий ли MKT; `get_escrow` падает из-за RPC/сети; `near state` или chain status расходятся. | **ABORT.** Повторить только read-only диагностику после стабилизации RPC. Ошибка view не равна отсутствию state. |
| MKT уже инициализирован или layout меняется. | **ABORT upgrade.** Миграционных хуков нет; `CONFIRM_UPGRADE=1` не решает совместимость. Только отдельный план владельца. |
| У аккаунта нет средств, ключа/прав, storage или gas недостаточно. | **ABORT до записи.** Сверить балансы/credentials у владельца; не печатать ключи. Не продолжать частично профинансированным прогоном. |
| `NEAR_SANDBOX_BINARY_PATH` указывает на файл/путь отсутствует; protocol 77 fallback; Roy1 сообщает SIGILL. | Локальный sandbox-прогон **ABORT**, исправить путь на каталог с p88 binary или перенести прогон на совместимую машину. Не объявлять контракт сломанным из-за protocol/CPU mismatch. |
| `near deploy`/`new`/call имеет потерянный или неясный receipt, transport error, phantom transfer либо несовпадающие балансы. | **ABORT всех следующих write-шагов.** Сначала `near tx-status`, `near state` и contract views; сверить signer, receipt и баланс. Ничего не повторять, пока исход не установлен. |
| Газовая ошибка, неожиданный revert/trap, bid serialization/deserialization error, истёк deadline, lot/status не тот. | **ABORT этого прогона.** Сверить chain state и receipt; не делать повторный `create_task`, `new` или `award_best` в надежде «дожать». |
| Недостаточно storage/phantom transfer или value ушёл не на ожидаемый аккаунт. | **ABORT и reconciliation** по аккаунтам/receipt до дальнейших действий; не компенсировать переводом без owner-решения. |
| После записи получен FAIL в I-A…I-G. | Считать это возможным расхождением on-chain. Зафиксировать значения и tx hash, эскалировать владельцу; не менять проверку под ожидаемые значения. |

## Источники

- `contracts/hivebid_market/integration/demo-rehearsal-403.js` — локальная near-workspaces репетиция и chain-time wait.
- `contracts/hivebid_market/deploy-testnet-nearcli.sh` — near-cli 4.0.13 deploy/smoke/edge, `wait_ms`, `call_retry`, `CONFIRM_UPGRADE`.
- `contracts/hivebid_market/integration/testnet-smoke.js` — `--plan` и только read-only `--run`.
- `contracts/hivebid_market/tests/prepare_wasm.rs` — prepare-gate для protocol 88.
- `docs/HIVEBID_BUILD.md`, `docs/deploy/DAY_CARD.md` — build и дополнительные traps.
- `reports/SPARK-deploy-403-1106.md`, `D:/Temp/reports/QODER-r1reconcile-377-1106.md`, `D:/Temp/reports/HERETIC-deployscripts-402-1106.md` — доказательства sandbox, source/WASM mismatch и abort-факторы.