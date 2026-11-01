// SPDX-License-Identifier: GPL-3.0-only

// updsign — утилита выпуска подписанных метаданных обновлений LAVRay
// (docs/UPDATE-SYSTEM.md). Команды:
//
//	genkey     создать ключ роли (root|timestamp|manifest|artifact)
//	root       подписать root.json (ключами root; при ротации — старыми и новыми)
//	sources    подписать sources.json
//	manifest   собрать и подписать manifest-<канал>.json, подписав установщики minisign
//	timestamp  подписать timestamp.json по манифестам каталога
//	artifact   подписать один файл minisign (<файл>.minisig)
//	verify     проверить каталог meta/ тем же кодом, что и клиент
//
// Приватный ключ читается из файла (file:ПУТЬ) или переменной окружения
// (env:ИМЯ), никогда не печатается и не принимается из файла внутри git-дерева.
package main

import (
	"fmt"
	"io"
	"os"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr, os.Getenv)) }

// run — точка входа для тестов: код выхода 0 — успех, 1 — ошибка, 2 — вызов.
func run(args []string, stdout, stderr io.Writer, getenv func(string) string) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	c := &cli{out: stdout, errw: stderr, getenv: getenv}
	cmds := map[string]func([]string) error{
		"genkey": c.genkey, "root": c.root, "sources": c.sources, "manifest": c.manifest,
		"timestamp": c.timestamp, "artifact": c.artifact, "verify": c.verify,
	}
	fn, ok := cmds[args[0]]
	if !ok {
		fmt.Fprintf(stderr, "неизвестная команда %q\n%s\n", args[0], usage)
		return 2
	}
	if err := fn(args[1:]); err != nil {
		fmt.Fprintln(stderr, "updsign:", err)
		return 1
	}
	return 0
}

// cli — окружение команд (вывод и переменные среды подменяются в тестах).
type cli struct {
	out, errw io.Writer
	getenv    func(string) string
}

const usage = `использование: updsign <команда> [флаги]
  genkey    -role root|timestamp|manifest|artifact -out ФАЙЛ [-pub ФАЙЛ]
  root      -key ID=file:ПУТЬ|env:ИМЯ [...] -in ЧЕРНОВИК -out root.json [-prev СТАРЫЙ_root.json]
  sources   -key file:ПУТЬ|env:ИМЯ -in ЧЕРНОВИК -out sources.json [-keyid r1] [-expires 720h]
  manifest  -key ... -artifact-key ... -product P -channel stable|beta -version V -asset ПЛАТФОРМА=ПУТЬ=ФАЙЛ -out ФАЙЛ
  timestamp -key ... -dir meta -out meta/timestamp.json [-keyid t1] [-expires 168h]
  artifact  -key ... -file ФАЙЛ -product P -platform PL -channel C -version V -serial N [-out ФАЙЛ.minisig]
  verify    -root root.json -dir meta [-assets ДИР] [-product P]`
