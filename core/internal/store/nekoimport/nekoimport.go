// Package nekoimport — импортёр каталога профилей NekoBox/NekoRay
// (core-port-plan §5.3, FR-UI-277).
//
// Читает <config_dir>/groups/*.json и <config_dir>/profiles/*.json в формате
// ui/db/Database.cpp (LoadManager): groups/pm.json — порядок вкладок,
// groups/nekobox.json — DataStore (настройки; переносится по таблице §5.4 в
// W3+, здесь игнорируется), groups/<id>.json — группы, profiles/<id>.json —
// ProxyEntity {type,id,gid,yc,report,bean,traffic}. Старый формат, где группа
// хранилась профилем с type=group, тоже принимается.
//
// Идентификаторы сохраняются (устойчивые ссылки chain-ов и front_proxy);
// исходный каталог не модифицируется; повторный импорт идемпотентен —
// уже существующие id пропускаются (AlreadyPresent). Неизвестные типы и
// битые файлы попадают в отчёт (Skipped), не прерывая импорт остальных.
package nekoimport

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/store"
)

// Skipped — файл, не перенесённый в хранилище (битый JSON, неизвестный тип,
// расхождение id и пр.). Отчёт о потерях — не тихо (FR-UI-260).
type Skipped struct {
	File   string `json:"file"`
	ID     int64  `json:"id,omitempty"`
	Type   string `json:"type,omitempty"`
	Reason string `json:"reason"`
}

// Report — сводка импорта: что перенесено, что пропущено.
type Report struct {
	GroupsImported int            `json:"groups_imported"`
	OldFmtGroups   int            `json:"old_format_groups"` // группы из profiles/ type=group
	ProfilesByType map[string]int `json:"profiles_by_type"`  // импортировано по типам
	AlreadyPresent int            `json:"already_present"`   // id уже в БД (повторный импорт)
	Skipped        []Skipped      `json:"skipped,omitempty"` // не перенесено (с причинами)
	Warnings       []string       `json:"warnings,omitempty"`
}

// ProfilesImported — всего импортированных профилей (сумма по типам).
func (r *Report) ProfilesImported() int {
	n := 0
	for _, c := range r.ProfilesByType {
		n += c
	}
	return n
}

func (r *Report) skip(file string, id int64, typ, reason string) {
	r.Skipped = append(r.Skipped, Skipped{File: file, ID: id, Type: typ, Reason: reason})
}

func (r *Report) warn(format string, args ...any) {
	r.Warnings = append(r.Warnings, fmt.Sprintf(format, args...))
}

// item — профиль, готовый к вставке.
type item struct {
	p *model.Profile
}

// Import переносит каталог NekoBox configDir в хранилище s.
func Import(s *store.Store, configDir string) (*Report, error) {
	rep := &Report{ProfilesByType: map[string]int{}}
	groupsDir := filepath.Join(configDir, "groups")
	profilesDir := filepath.Join(configDir, "profiles")

	// Порядок вкладок: groups/pm.json → {"groups":[id…]} (Database.cpp:13).
	tabOrder := readTabOrder(filepath.Join(groupsDir, "pm.json"))

	// 1. Группы нового формата: groups/<id>.json (pm.json и nekobox.json
	// отфильтрованы — имя не парсится как число, как filterIntJsonFile).
	raw := map[int64]*nekoGroup{}
	for _, gid := range intJSONIDs(groupsDir) {
		rel := filepath.Join("groups", strconv.FormatInt(gid, 10)+".json")
		ng, err := readNekoGroup(filepath.Join(configDir, rel))
		if err != nil {
			rep.skip(rel, gid, "", err.Error())
			continue
		}
		if ng.ID != gid { // LoadManager: corrupted group → пропуск
			rep.skip(rel, gid, "", fmt.Sprintf("id mismatch: file %d, content %d", gid, ng.ID))
			continue
		}
		raw[gid] = ng
	}

	// 2. Профили — сначала в память; type=group → группа старого формата.
	items := map[int64]*item{}
	for _, pid := range intJSONIDs(profilesDir) {
		rel := filepath.Join("profiles", strconv.FormatInt(pid, 10)+".json")
		ent, err := readNekoEntity(filepath.Join(configDir, rel))
		if err != nil {
			rep.skip(rel, pid, "", err.Error())
			continue
		}
		if ent.ID != pid {
			rep.skip(rel, pid, ent.Type, fmt.Sprintf("id mismatch: file %d, content %d", pid, ent.ID))
			continue
		}
		if ent.Type == "group" { // старый формат: группа как профиль
			g := oldFmtGroup(ent)
			if _, exists := raw[g.ID]; exists {
				rep.warn("old-format group %d ignored: groups/%d.json already imported", g.ID, g.ID)
				continue
			}
			raw[g.ID] = g
			rep.OldFmtGroups++
			continue
		}
		p, err := mapProfile(ent)
		if err != nil {
			rep.skip(rel, pid, ent.Type, err.Error())
			continue
		}
		items[pid] = &item{p: p}
	}

	// 3. Модельные группы + отложенные front_proxy_id (FK на profiles(id):
	// проставляем после вставки профилей).
	groups := map[int64]*model.Group{}
	frontProxy := map[int64]int64{}
	for gid, ng := range raw {
		g, fp := toGroup(ng)
		groups[gid] = g
		if fp >= 0 {
			frontProxy[gid] = fp
		}
	}

	// 4. Порядок создания групп: pm.json, затем не перечисленные по id.
	createOrder := make([]int64, 0, len(groups))
	seen := map[int64]bool{}
	for _, gid := range tabOrder {
		if groups[gid] != nil && !seen[gid] {
			createOrder = append(createOrder, gid)
			seen[gid] = true
		}
	}
	rest := make([]int64, 0, len(groups))
	for gid := range groups {
		if !seen[gid] {
			rest = append(rest, gid)
		}
	}
	sort.Slice(rest, func(i, j int) bool { return rest[i] < rest[j] })
	createOrder = append(createOrder, rest...)

	if len(createOrder) == 0 && len(items) > 0 {
		g := &model.Group{Name: "Imported", Kind: model.GroupBasic}
		if err := s.CreateGroup(g); err != nil {
			return nil, fmt.Errorf("nekoimport: create fallback group: %w", err)
		}
		groups[g.ID] = g
		raw[g.ID] = &nekoGroup{ID: g.ID}
		createOrder = append(createOrder, g.ID)
		rep.GroupsImported++
		rep.warn("no groups found; created fallback group %q (id %d)", g.Name, g.ID)
	}

	// 5. Группы → БД (id сохраняются для ссылок профилей).
	for _, gid := range createOrder {
		switch _, err := s.GetGroup(gid); {
		case err == nil:
			rep.AlreadyPresent++
			continue
		case !errors.Is(err, store.ErrNotFound):
			return nil, fmt.Errorf("nekoimport: group %d: %w", gid, err)
		}
		if err := s.ImportGroup(groups[gid]); err != nil {
			return nil, fmt.Errorf("nekoimport: create group %d: %w", gid, err)
		}
		rep.GroupsImported++
	}

	// 6. Профили → БД: в порядке отображения группы (order-поле), затем
	// хвост по id (CreateProfile дописывает в конец → порядок сохраняется).
	fallbackGID := int64(0)
	if len(createOrder) > 0 {
		fallbackGID = createOrder[0]
	}
	for _, gid := range createOrder {
		listed := map[int64]bool{}
		for _, pid := range raw[gid].Order {
			it, ok := items[pid]
			if !ok || listed[pid] {
				continue
			}
			listed[pid] = true
			rep.insert(s, it.p, gid, fallbackGID)
		}
		var tail []int64
		for pid, it := range items {
			if it.p.GroupID == gid && !listed[pid] {
				tail = append(tail, pid)
			}
		}
		sort.Slice(tail, func(i, j int) bool { return tail[i] < tail[j] })
		for _, pid := range tail {
			rep.insert(s, items[pid].p, gid, fallbackGID)
		}
	}
	// Профили, чья группа не существовала (битая/пропущена) — в первую группу.
	var orphans []int64
	for pid, it := range items {
		if groups[it.p.GroupID] == nil {
			orphans = append(orphans, pid)
		}
	}
	sort.Slice(orphans, func(i, j int) bool { return orphans[i] < orphans[j] })
	for _, pid := range orphans {
		p := items[pid].p
		rep.warn("profile %d: group %d missing; imported into group %d", pid, p.GroupID, fallbackGID)
		rep.insert(s, p, fallbackGID, fallbackGID)
	}

	// 7. front_proxy_id групп — после профилей (FK на profiles(id)).
	for _, gid := range createOrder {
		fp, ok := frontProxy[gid]
		if !ok {
			continue
		}
		switch _, err := s.GetProfile(fp); {
		case errors.Is(err, store.ErrNotFound):
			rep.warn("group %d: front_proxy_id %d references missing profile; dropped", gid, fp)
			continue
		case err != nil:
			return nil, fmt.Errorf("nekoimport: front proxy check: %w", err)
		}
		g := groups[gid]
		v := fp
		g.FrontProxyID = &v
		if err := s.UpdateGroup(g); err != nil {
			return nil, fmt.Errorf("nekoimport: set front proxy of group %d: %w", gid, err)
		}
	}
	return rep, nil
}

// insert вставляет профиль с учётом идемпотентности по id (§5.3: повторный
// импорт не дублирует).
func (r *Report) insert(s *store.Store, p *model.Profile, gid, fallbackGID int64) {
	p.GroupID = gid
	switch _, err := s.GetProfile(p.ID); {
	case err == nil:
		r.AlreadyPresent++
		return
	case !errors.Is(err, store.ErrNotFound):
		r.warn("profile %d: check: %v", p.ID, err)
		return
	}
	if err := s.ImportProfile(p); err != nil {
		r.skip(fmt.Sprintf("profiles/%d.json", p.ID), p.ID, string(p.Type),
			fmt.Sprintf("create: %v", err))
		return
	}
	r.ProfilesByType[string(p.Type)]++
}

// ---- чтение каталога ----

// intJSONIDs — id из имён файлов <id>.json (аналог filterIntJsonFile,
// Database.cpp:17): pm.json/nekobox.json и нечисловые имена игнорируются.
func intJSONIDs(dir string) []int64 {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var ids []int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".json") {
			continue
		}
		base := strings.TrimSuffix(name, filepath.Ext(name))
		id, err := strconv.ParseInt(base, 10, 64)
		if err != nil || id < 0 {
			continue
		}
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func readTabOrder(fn string) []int64 {
	b, err := os.ReadFile(fn)
	if err != nil {
		return nil
	}
	var pm struct {
		Groups []int64 `json:"groups"`
	}
	if err := json.Unmarshal(b, &pm); err != nil {
		return nil
	}
	return pm.Groups
}

// ---- структуры формата NekoBox ----

// nekoEntity — profiles/<id>.json (ProxyEntity, db/Database.cpp:208).
type nekoEntity struct {
	Type    string          `json:"type"`
	ID      int64           `json:"id"`
	Gid     int64           `json:"gid"`
	Yc      *int32          `json:"yc"` // 0 = не тестировали; <0 unavailable; >0 мс
	Report  string          `json:"report"`
	Bean    json.RawMessage `json:"bean"`
	Traffic struct {
		DL int64 `json:"dl"`
		UL int64 `json:"ul"`
	} `json:"traffic"`
}

// nekoBean — объединение полей всех bean-ов (fmt/*.hpp); неизвестные поля
// игнорируются (как JsonStore::FromJson — прямая совместимость).
// Пустые строки NekoBox в JSON не пишет (JsonStore::ToJson), отсутствие
// поля = пустое значение.
type nekoBean struct {
	// AbstractBean (fmt/AbstractBean.cpp)
	V    int    `json:"_v"`
	Name string `json:"name"`
	Addr string `json:"addr"`
	Port int    `json:"port"`
	CCfg string `json:"c_cfg"`
	COut string `json:"c_out"`

	// SocksHttpBean
	SocksType int    `json:"v"` // 5 socks5 | 4 socks4 | -80 http
	Username  string `json:"username"`
	Password  string `json:"password"`

	// ShadowSocksBean
	Method string `json:"method"`
	Pass   string `json:"pass"`
	Plugin string `json:"plugin"`
	Uot    int    `json:"uot"`

	// VMessBean
	VMessID string `json:"id"` // uuid
	Aid     int    `json:"aid"`
	Sec     string `json:"sec"`

	// TrojanVLESSBean (пароль в общем поле Pass)
	Flow string `json:"flow"`

	// QUICBean (hysteria2 | tuic)
	ObfsPassword   string `json:"obfsPassword"`
	UploadMbps     int    `json:"uploadMbps"`
	DownloadMbps   int    `json:"downloadMbps"`
	HopIntervalSec int    `json:"hopInterval"`
	HopPort        string `json:"hopPort"`
	TUICUUID       string `json:"uuid"`
	Congestion     string `json:"congestionControl"`
	UDPRelayMode   string `json:"udpRelayMode"`
	ZeroRtt        bool   `json:"zeroRttHandshake"`
	Heartbeat      string `json:"heartbeat"`
	Uos            bool   `json:"uos"`
	AllowInsecure  bool   `json:"allowInsecure"`
	QUICSNI        string `json:"sni"`
	ALPN           string `json:"alpn"`
	CaText         string `json:"caText"`
	DisableSni     bool   `json:"disableSni"`

	// NaiveBean
	Protocol     string `json:"protocol"`
	ExtraHeaders string `json:"extra_headers"`
	Certificate  string `json:"certificate"`
	InsecureConc int    `json:"insecure_concurrency"`
	DisableLog   bool   `json:"disable_log"`

	// CustomBean
	Core         string   `json:"core"`
	Command      []string `json:"cmd"`
	ConfigSimple string   `json:"cs"`
	ConfigSuffix string   `json:"cs_suffix"`
	MappingPort  int      `json:"mapping_port"`
	SocksPort    int      `json:"socks_port"`

	// ChainBean
	List []int64 `json:"list"`

	// Группа старого формата (профиль с type=group)
	URL            string  `json:"url"`
	Info           string  `json:"info"`
	Lastup         int64   `json:"lastup"`
	Order          []int64 `json:"order"`
	Archive        *bool   `json:"archive"`
	SkipAutoUpdate *bool   `json:"skip_auto_update"`
	FrontProxyID   *int64  `json:"front_proxy_id"`

	Stream *nekoStream `json:"stream"`
}

// nekoStream — V2rayStreamSettings (fmt/V2RayStreamSettings.hpp).
type nekoStream struct {
	Network        string `json:"net"`
	Security       string `json:"sec"`
	PacketEncoding string `json:"pac_enc"`
	Path           string `json:"path"`
	Host           string `json:"host"`
	HeaderType     string `json:"h_type"`
	SNI            string `json:"sni"`
	ALPN           string `json:"alpn"`
	Certificate    string `json:"cert"`
	UTLS           string `json:"utls"`
	Insecure       bool   `json:"insecure"`
	EdName         string `json:"ed_name"`
	EdLen          int    `json:"ed_len"`
	Pbk            string `json:"pbk"`
	Sid            string `json:"sid"`
	Spx            string `json:"spx"`
	MuxS           int    `json:"mux_s"`
}

// nekoGroup — groups/<id>.json (db/Group.hpp, Database.cpp:306).
type nekoGroup struct {
	ID                  int64   `json:"id"`
	FrontProxyID        int64   `json:"front_proxy_id"` // -1 = нет
	Archive             bool    `json:"archive"`
	SkipAutoUpdate      bool    `json:"skip_auto_update"`
	Name                string  `json:"name"`
	Order               []int64 `json:"order"`
	URL                 string  `json:"url"`
	Info                string  `json:"info"`
	Lastup              int64   `json:"lastup"`
	ManuallyColumnWidth bool    `json:"manually_column_width"`
	ColumnWidth         []int   `json:"column_width"`
}

func readNekoGroup(fn string) (*nekoGroup, error) {
	b, err := os.ReadFile(fn)
	if err != nil {
		return nil, err
	}
	var g nekoGroup
	if err := json.Unmarshal(b, &g); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return &g, nil
}

func readNekoEntity(fn string) (*nekoEntity, error) {
	b, err := os.ReadFile(fn)
	if err != nil {
		return nil, err
	}
	var ent nekoEntity
	if err := json.Unmarshal(b, &ent); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return &ent, nil
}

// ---- маппинг NekoBox → модель LAVRay ----

// nekoLastupMs: NekoBox хранит lastup в СЕКУНДАХ (GroupUpdater.cpp:564 —
// currentMSecsSinceEpoch()/1000); модель — в мс. Эвристика на стык эпох:
// значение < 1e11 (≈5137 год в мс) считаем секундами.
func nekoLastupMs(sec int64) int64 {
	if sec > 0 && sec < 1_00_000_000_000 {
		return sec * 1000
	}
	return sec
}

// toGroup конвертирует группу; вторым значением — front_proxy_id (-1 = нет).
func toGroup(ng *nekoGroup) (*model.Group, int64) {
	g := &model.Group{
		ID:              ng.ID,
		Name:            ng.Name,
		Kind:            model.GroupBasic,
		SubscriptionURL: ng.URL,
		Archive:         ng.Archive,
		SkipAutoUpdate:  ng.SkipAutoUpdate,
		LastUpdateMs:    nekoLastupMs(ng.Lastup),
	}
	if ng.URL != "" {
		g.Kind = model.GroupSubscription
	}
	g.SubscriptionInfo = parseSubscriptionUserInfo(ng.Info)
	if ng.ManuallyColumnWidth || len(ng.ColumnWidth) > 0 {
		ui := map[string]any{}
		if ng.ManuallyColumnWidth {
			ui["manually_column_width"] = true
		}
		if len(ng.ColumnWidth) > 0 {
			ui["column_width"] = ng.ColumnWidth
		}
		if b, err := json.Marshal(ui); err == nil {
			g.UIState = string(b)
		}
	}
	return g, ng.FrontProxyID
}

// oldFmtGroup — группа старого формата: profiles/<id>.json с type=group
// (bean несёт поля группы; имя файла — id группы).
func oldFmtGroup(ent *nekoEntity) *nekoGroup {
	b := &nekoBean{}
	if len(ent.Bean) > 0 {
		_ = json.Unmarshal(ent.Bean, b) // лучшие усилия: что распарсилось — то перенесём
	}
	g := &nekoGroup{
		ID:           ent.ID,
		Name:         b.Name,
		URL:          b.URL,
		Info:         b.Info,
		Lastup:       b.Lastup,
		Order:        b.Order,
		FrontProxyID: -1,
	}
	if g.Name == "" {
		g.Name = fmt.Sprintf("Group %d", ent.ID)
	}
	if b.Archive != nil {
		g.Archive = *b.Archive
	}
	if b.SkipAutoUpdate != nil {
		g.SkipAutoUpdate = *b.SkipAutoUpdate
	}
	if b.FrontProxyID != nil {
		g.FrontProxyID = *b.FrontProxyID
	}
	return g
}

// parseSubscriptionUserInfo разбирает заголовок Subscription-UserInfo
// («upload=…; download=…; total=…; expire=<unix-секунды>») — так NekoBox
// хранит его в Group.info (sub/GroupUpdater.cpp:565).
func parseSubscriptionUserInfo(info string) *model.SubscriptionInfo {
	if strings.TrimSpace(info) == "" {
		return nil
	}
	si := &model.SubscriptionInfo{}
	found := false
	for _, part := range strings.Split(info, ";") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil {
			continue
		}
		switch k {
		case "upload":
			upload := n
			si.UploadBytes = &upload
			found = true
		case "download":
			download := n
			si.DownloadBytes = &download
			found = true
		case "total":
			total := n
			si.TotalBytes = &total
			found = true
		case "expire":
			expire := n * 1000 // unix-секунды → мс
			si.ExpireMs = &expire
			found = true
		}
	}
	if !found {
		return nil
	}
	return si
}

// mapProfile конвертирует ProxyEntity NekoBox в профиль LAVRay.
// Ошибка = профиль не переносится (неизвестный тип) → в отчёт, без падения.
// Custom-поля (c_cfg/c_out и core/cmd кастомного bean) переносятся только в
// CustomFieldsConfirmed=false-виде (LNB-25, §5.3).
func mapProfile(ent *nekoEntity) (*model.Profile, error) {
	b := &nekoBean{}
	if len(ent.Bean) > 0 {
		if err := json.Unmarshal(ent.Bean, b); err != nil {
			return nil, fmt.Errorf("invalid bean JSON: %w", err)
		}
	}
	addr := store.SanitizeAddress(b.Addr)
	if addr == "" {
		addr = "127.0.0.1" // дефолт AbstractBean::serverAddress (пустое в JSON не пишется)
	}
	p := &model.Profile{
		ID:                 ent.ID,
		GroupID:            ent.Gid,
		Name:               b.Name,
		Address:            addr,
		Port:               b.Port,
		CustomConfigJSON:   b.CCfg,
		CustomOutboundJSON: b.COut, // CustomFieldsConfirmed = false (LNB-25)
		LegacyBean:         string(ent.Bean),
	}
	if ent.Yc != nil && *ent.Yc != 0 { // yc 0 = не тестировали
		yc := *ent.Yc
		p.TestResult.LatencyMs = &yc
	}
	p.TestResult.FullReport = ent.Report
	p.Traffic = model.TrafficCounters{DownlinkBytes: ent.Traffic.DL, UplinkBytes: ent.Traffic.UL}

	stream := mapStream(b.Stream)
	switch ent.Type {
	case "socks", "http":
		p.Type = model.TypeSOCKS
		proto := "socks5"
		if ent.Type == "http" {
			p.Type = model.TypeHTTP
			proto = "http"
		} else if b.SocksType == 4 {
			proto = "socks4"
		}
		p.Detail = &model.SocksHTTPDetail{Proto: proto, Username: b.Username, Password: b.Password}
		p.Stream = stream
	case "shadowsocks":
		p.Type = model.TypeShadowsocks
		p.Detail = &model.ShadowsocksDetail{Method: b.Method, Password: b.Pass, Plugin: b.Plugin, UDPOverTCP: b.Uot}
		p.Stream = stream
	case "vmess":
		p.Type = model.TypeVMess
		p.Detail = &model.VMessDetail{UUID: b.VMessID, AlterID: b.Aid, Security: b.Sec}
		p.Stream = stream
	case "trojan":
		p.Type = model.TypeTrojan
		p.Detail = &model.TrojanVlessDetail{Password: b.Pass, Flow: b.Flow}
		p.Stream = stream
	case "vless":
		p.Type = model.TypeVLESS
		p.Detail = &model.TrojanVlessDetail{Password: b.Pass, Flow: b.Flow}
		p.Stream = stream
	case "naive":
		p.Type = model.TypeNaive
		p.Detail = &model.NaiveDetail{
			Username:            b.Username,
			Password:            b.Password,
			Proto:               b.Protocol,
			ExtraHeaders:        b.ExtraHeaders,
			SNI:                 b.QUICSNI,
			Certificate:         b.Certificate,
			InsecureConcurrency: b.InsecureConc,
			DisableLogs:         b.DisableLog,
		}
	case "hysteria2":
		p.Type = model.TypeHysteria2
		hop := ""
		if b.HopIntervalSec > 0 {
			hop = fmt.Sprintf("%ds", b.HopIntervalSec) // int-секунды → Duration-строка (FR-UI-268)
		}
		p.Detail = &model.Hysteria2Detail{
			Password:      b.Password, // QUICBean пишет ключ «password»
			ObfsPassword:  b.ObfsPassword,
			UploadMbps:    b.UploadMbps,
			DownloadMbps:  b.DownloadMbps,
			ServerPorts:   b.HopPort,
			HopInterval:   hop,
			SNI:           b.QUICSNI,
			ALPN:          b.ALPN,
			CA:            b.CaText,
			AllowInsecure: b.AllowInsecure,
			DisableSNI:    b.DisableSni,
		}
	case "tuic":
		p.Type = model.TypeTUIC
		p.Detail = &model.TUICDetail{
			UUID:              b.TUICUUID,
			Password:          b.Password, // QUICBean пишет ключ «password»
			CongestionControl: b.Congestion,
			UDPRelayMode:      b.UDPRelayMode,
			ZeroRttHandshake:  b.ZeroRtt,
			Heartbeat:         b.Heartbeat,
			SNI:               b.QUICSNI,
			ALPN:              b.ALPN,
			CA:                b.CaText,
			AllowInsecure:     b.AllowInsecure,
			DisableSNI:        b.DisableSni,
			UDPOverStream:     b.Uos,
		}
	case "custom":
		d := &model.CustomDetail{
			Core:             b.Core,
			ExternalCoreName: b.Core, // внешнее ядро именуется значением core
			Command:          b.Command,
			ConfigSuffix:     b.ConfigSuffix,
			MappingPort:      b.MappingPort,
			SocksPort:        b.SocksPort,
		}
		switch b.Core {
		case "internal":
			p.Type = model.TypeCustomOutbound
			d.OutboundJSON = b.ConfigSimple
		case "internal-full":
			p.Type = model.TypeCustomConfig
			d.FullConfigJSON = b.ConfigSimple
		default:
			// core=external: за флагом enable_external_cores (решение №5);
			// при импорте сохраняем, применение — на стороне W6/API.
			// Core = литерал "external" (контракт модели/proto); имя ядра —
			// в ExternalCoreName (см. N2 ревью).
			p.Type = model.TypeCustomExternal
			d.Core = "external"
			d.ConfigTemplate = b.ConfigSimple
		}
		p.Detail = d
	case "chain":
		p.Type = model.TypeChain
		p.Detail = &model.ChainDetail{ProfileIDs: b.List}
	default:
		return nil, fmt.Errorf("unknown profile type %q", ent.Type)
	}
	return p, nil
}

// mapStream конвертирует V2rayStreamSettings (nil → nil).
func mapStream(ns *nekoStream) *model.StreamSettings {
	if ns == nil {
		return nil
	}
	return &model.StreamSettings{
		Network:           ns.Network,
		HeaderType:        ns.HeaderType,
		Path:              ns.Path,
		Host:              ns.Host,
		WSEarlyDataHeader: ns.EdName,
		WSEarlyDataMax:    ns.EdLen,
		Security:          ns.Security,
		SNI:               ns.SNI,
		ALPN:              ns.ALPN,
		AllowInsecure:     ns.Insecure,
		Certificate:       ns.Certificate,
		UTLSFingerprint:   ns.UTLS,
		RealityPublicKey:  ns.Pbk,
		RealityShortID:    ns.Sid,
		RealitySPX:        ns.Spx,
		PacketEncoding:    ns.PacketEncoding,
		Multiplex:         ns.MuxS,
	}
}
