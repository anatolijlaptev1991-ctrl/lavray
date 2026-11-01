// SPDX-License-Identifier: GPL-3.0-only

package main

// ext_token.go — --token-file: токен ядра из файла для сервисного режима (procd на
// OpenWrt). У службы нет оболочки, которая пишет токен в stdin, а EOF stdin
// означает «оболочка умерла — выходим». С файлом читатель стартового ввода
// получает токен первой строкой и затем никогда не видит EOF.

import (
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
)

// minFileTokenLen — как у агентского токена: 32 символа и больше.
const minFileTokenLen = minAgentTokenLen

// neverReader блокируется навсегда: «stdin» без конца.
type neverReader struct{}

func (neverReader) Read([]byte) (int, error) { select {} }

// loadToken читает и проверяет файл токена. На Unix файл не должен читаться
// группой и остальными: токен открывает полный доступ к API ядра.
func (f *extFlags) loadToken() error {
	st, err := os.Stat(f.tokenFile)
	if err != nil {
		return fmt.Errorf("--token-file: %w", err)
	}
	if runtime.GOOS != "windows" && st.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("--token-file %s доступен другим пользователям (права %04o): нужен 0600", f.tokenFile, st.Mode().Perm())
	}
	raw, err := os.ReadFile(f.tokenFile)
	if err != nil {
		return fmt.Errorf("--token-file: %w", err)
	}
	tok, _, _ := strings.Cut(strings.TrimSpace(string(raw)), "\n")
	tok = strings.TrimSpace(tok)
	if len(tok) < minFileTokenLen {
		return fmt.Errorf("--token-file %s: токен короче %d символов", f.tokenFile, minFileTokenLen)
	}
	f.token = tok
	return nil
}

// input — откуда ядро читает токен при старте: stdin оболочки либо файл токена.
func (f *extFlags) input(stdin io.Reader) io.Reader {
	if f.tokenFile == "" {
		return stdin
	}
	return io.MultiReader(strings.NewReader(f.token+"\n"), neverReader{})
}
