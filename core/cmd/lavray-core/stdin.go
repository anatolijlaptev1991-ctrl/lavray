// SPDX-License-Identifier: GPL-3.0-only

package main

import (
	"bufio"
	"io"
	"strings"
)

// minAgentTokenLen — самый короткий принимаемый агентский токен. Оболочка
// выдаёт 32 байта CSPRNG в base64url (43 символа); короткое значение — ошибка
// передачи или подделка, агентский доступ тогда остаётся закрытым.
const minAgentTokenLen = 32

// readStartupStdin — единственный читатель stdin ядра (§3.2).
//
//	строка 1: основной токен → token;
//	строка 2: агентский токен MCP (необязательная) → agent;
//	дальше:   остаток читается до EOF, EOF = смерть оболочки → закрытие dead.
//
// Читатель один, и буфер у него общий: вторая строка не теряется в буфере
// первого чтения. Каналы token и agent должны быть буферизованными (1):
// читатель не ждёт получателя. agent закрывается, когда второй строки не
// будет (EOF или чтение остановилось), чтобы получатель не ждал вечно. Первая
// строка без перевода строки перед EOF тоже считается токеном, как раньше.
func readStartupStdin(in io.Reader, token, agent chan<- string, dead chan<- struct{}) {
	br := bufio.NewReader(in)
	line, err := br.ReadString('\n')
	if err != nil && line == "" {
		token <- ""
	} else {
		token <- strings.TrimSpace(line)
	}
	if err == nil {
		if second, err2 := br.ReadString('\n'); err2 == nil {
			agent <- strings.TrimSpace(second)
		}
	}
	close(agent)
	_, _ = io.Copy(io.Discard, br)
	close(dead)
}
