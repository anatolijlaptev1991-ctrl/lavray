// SPDX-License-Identifier: GPL-3.0-only

package model

// customhash.go — хэш custom-содержимого профиля (T-08B). Подтверждение
// custom-полей хранится как этот хэш и действует, пока содержимое не
// изменилось: CustomConfirmed пересчитывает хэш при каждом чтении, поэтому
// клиент не может «выставить флаг», а любая правка содержимого снимает
// подтверждение сама.
//
//	H = sha256("LAVCF1" 0x00 ‖ seg(custom_outbound) ‖ 0x00 ‖ seg(custom_config)
//	           [‖ 0x00 ‖ canon(full_config) — только internal-full])
//
// seg(x) — CanonicalJSON(x), пустой документ и "{}" дают "" (сборка конфига
// их тоже не применяет). Канонический JSON не содержит байта 0x00, поэтому
// разделитель однозначен: (x, "") и ("", x) дают разные хэши.

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// customHashDomain — префикс версии формулы: смена формулы меняет все хэши.
const customHashDomain = "LAVCF1\x00"

// IsInternalFull — профиль «свой полный конфиг» (CUSTOM_CONFIG, core
// internal-full): конфиг ядра берётся из профиля целиком.
func IsInternalFull(p *Profile) bool {
	d, ok := p.Detail.(*CustomDetail)
	return ok && p.Type == TypeCustomConfig && d.Core == "internal-full"
}

// internalFullJSON — полный конфиг internal-full профиля ("" у остальных).
func internalFullJSON(p *Profile) string {
	if !IsInternalFull(p) {
		return ""
	}
	return p.Detail.(*CustomDetail).FullConfigJSON
}

// customSegment — каноническое значение одного custom-поля для хэша.
func customSegment(raw string) (string, error) {
	c, err := CanonicalJSON(raw)
	if err != nil || c == "{}" {
		return "", err
	}
	return c, nil
}

// HasCustomContent — есть ли у профиля что подтверждать: непустое
// custom_outbound/custom_config (невалидный JSON тоже считается содержимым)
// или профиль internal-full.
func HasCustomContent(p *Profile) bool {
	if IsInternalFull(p) {
		return true
	}
	for _, raw := range []string{p.CustomOutboundJSON, p.CustomConfigJSON} {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		if seg, err := customSegment(raw); err != nil || seg != "" {
			return true
		}
	}
	return false
}

// CustomFieldsHash — sha256 (64 hex) custom-содержимого профиля. Ошибка —
// одно из полей не разбирается как JSON (или в нём дубли ключей).
func CustomFieldsHash(p *Profile) (string, error) {
	out, err := customSegment(p.CustomOutboundJSON)
	if err != nil {
		return "", err
	}
	cfg, err := customSegment(p.CustomConfigJSON)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	h.Write([]byte(customHashDomain))
	h.Write([]byte(out))
	h.Write([]byte{0})
	h.Write([]byte(cfg))
	if IsInternalFull(p) {
		full, err := CanonicalJSON(internalFullJSON(p))
		if err != nil {
			return "", err
		}
		h.Write([]byte{0})
		h.Write([]byte(full))
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// CustomConfirmed — подтверждено ли текущее содержимое: есть что подтверждать
// и сохранённый CustomHash равен хэшу текущего содержимого.
func CustomConfirmed(p *Profile) bool {
	if p.CustomHash == "" || !HasCustomContent(p) {
		return false
	}
	h, err := CustomFieldsHash(p)
	return err == nil && h == p.CustomHash
}
