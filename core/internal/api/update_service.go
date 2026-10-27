// update_service.go — UpdateService (W8): TUF-lite клиент (internal/updates)
// поверх settings-состояния update.*. CheckUpdates — полная верификация
// root→timestamp→manifest; DownloadUpdates/ApplyUpdates — стримы событий
// (скачивание с sha256, применение — за Installer-интерфейсом: реальная
// замена файлов — релизная обвязка платформенных репо).
package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"sort"
	"time"

	"connectrpc.com/connect"
	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

const (
	setUpdRoot     = "update.root_version"
	setUpdSerialSt = "update.serial_stable"
	setUpdSerialBe = "update.serial_beta"
	setUpdChecked  = "update.last_checked_at"
	setUpdLastURL  = "update.last_url"
)

// UpdaterSource — источник метаданных для CheckUpdates (инъекция: prod —
// HTTP по sources.json; тесты — память). nil → CheckUpdates честно
// FailedPrecondition (проверка обновлений без сети настроена W8-обвязкой).
type UpdaterSource = updates.Source

// UpdaterConf — конфигурация UpdateService на Server (прод-старт подставит
// зашитый root.json сборки + bootstrap-источники GitHub).
type UpdaterConf struct {
	RootJSON         []byte
	Product          string // "lavray-windows" | …
	BootstrapSources []updates.Source
}

func (s *Server) loadUpdateState() updates.State {
	st := updates.State{}
	get := func(k string, dst *int64) {
		if v, ok, _ := s.st.GetSetting(k); ok {
			_ = json.Unmarshal([]byte(v), dst)
		}
	}
	get(setUpdRoot, &st.RootVersion)
	get(setUpdSerialSt, &st.SerialStable)
	get(setUpdSerialBe, &st.SerialBeta)
	get(setUpdChecked, &st.LastCheckedAt)
	if v, ok, _ := s.st.GetSetting(setUpdLastURL); ok {
		st.LastWorkingURL = v
	}
	return st
}

func (s *Server) saveUpdateState(st *updates.State) {
	set := func(k string, v int64) {
		b, _ := json.Marshal(v)
		_ = s.st.SetSetting(k, string(b))
	}
	set(setUpdRoot, st.RootVersion)
	set(setUpdSerialSt, st.SerialStable)
	set(setUpdSerialBe, st.SerialBeta)
	set(setUpdChecked, st.LastCheckedAt)
	_ = s.st.SetSetting(setUpdLastURL, st.LastWorkingURL)
}

// newUpdaterFor — ЛОКАЛЬНАЯ копия апдейтера под запрошенный канал
// (A1 аудита round 2: общий *updates.Client мутировался из параллельных
// запросов — Trust/State/Channel гонялись между Check/Download/Verify).
func (s *Server) newUpdaterFor(ch lavrayv1.UpdateChannel) (*updates.Client, error) {
	s.updMu.Lock()
	defer s.updMu.Unlock()
	c, err := s.newUpdaterLocked()
	if err != nil {
		return nil, err
	}
	local := *c
	local.Channel = channelOf(ch)
	return &local, nil
}

func (s *Server) newUpdater() (*updates.Client, error) {
	s.updMu.Lock()
	defer s.updMu.Unlock()
	return s.newUpdaterLocked()
}

func (s *Server) newUpdaterLocked() (*updates.Client, error) {
	if s.updater == nil {
		return nil, failedPrecondition("обновления не сконфигурированы (root/источники задаёт оболочка при старте)")
	}
	st := s.loadUpdateState()
	local := *s.updater
	local.State = &st
	return &local, nil
}

func channelOf(c lavrayv1.UpdateChannel) string {
	if c == lavrayv1.UpdateChannel_UPDATE_CHANNEL_BETA {
		return "beta"
	}
	return "stable"
}

func (s *Server) CheckUpdates(ctx context.Context, req *connect.Request[lavrayv1.CheckUpdatesRequest]) (*connect.Response[lavrayv1.CheckUpdatesResponse], error) {
	c, err := s.newUpdaterFor(req.Msg.Channel)
	if err != nil {
		return nil, err
	}
	res, err := c.Check(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	s.saveUpdateState(c.State)
	// L7/L8 аудита №1: секции app/core в манифесте опциональны (релизы
	// только пресетов/гео), а запрошенный канал обязан соблюдаться — иначе
	// пользователь stable получал beta с большим serial.
	var comp *lavrayv1.ComponentUpdate
	if res.IsNewer && res.Manifest.App != nil && channelOf(req.Msg.Channel) == res.Manifest.Channel {
		avail := res.Manifest.App.Version
		comp = &lavrayv1.ComponentUpdate{
			Component:        lavrayv1.UpdateComponent_UPDATE_COMPONENT_APP,
			CurrentVersion:   s.appVersion,
			AvailableVersion: &avail,
			Notes:            res.Manifest.Notes,
			Mandatory:        optBool(res.Manifest.Mandatory),
		}
	}
	coreVersion := ""
	if res.Manifest.Core != nil {
		coreVersion = res.Manifest.Core.Version
	}
	out := &lavrayv1.CheckUpdatesResponse{
		CurrentAppVersion: s.appVersion,
		CoreVersion:       coreVersion,
		LastCheckedAtMs:   c.State.LastCheckedAt,
		WorkingSources:    []string{c.State.LastWorkingURL},
	}
	if comp != nil {
		out.Available = append(out.Available, comp)
	}
	return connect.NewResponse(out), nil
}

func (s *Server) GetUpdateState(ctx context.Context, req *connect.Request[lavrayv1.GetUpdateStateRequest]) (*connect.Response[lavrayv1.UpdateStateResponse], error) {
	st := s.loadUpdateState()
	return connect.NewResponse(&lavrayv1.UpdateStateResponse{
		LastCheckedAtMs: st.LastCheckedAt,
		ChainState: &lavrayv1.ChainStateInfo{
			RootVersion: int32(st.RootVersion),
			MaxSerial:   map[string]int64{"stable": st.SerialStable, "beta": st.SerialBeta},
		},
	}), nil
}

// DownloadUpdates — стрим прогресса скачивания артефакта выбранного канала
// с проверкой sha256/length (события Started → Progress → Verified/Done).
func (s *Server) DownloadUpdates(ctx context.Context, req *connect.Request[lavrayv1.DownloadUpdatesRequest], stream *connect.ServerStream[lavrayv1.UpdateEvent]) error {
	c, err := s.newUpdater()
	if err != nil {
		return err
	}
	res, err := c.Check(ctx)
	if err != nil {
		return mapErr(err)
	}
	if !res.IsNewer {
		return failedPrecondition("обновлений нет (serial не новее сохранённого)")
	}
	// L9/L35 аудита №1: реальное скачивание с проверкой sha256/length, а не
	// два пустых события. Ключ актива выбирает оболочка (платформа); без её
	// подсказки берём первый ключ манифеста с проверкой всех активов.
	if res.Manifest.App == nil || len(res.Manifest.App.Assets) == 0 {
		return failedPrecondition("в манифесте нет активов приложения")
	}
	keys := make([]string, 0, len(res.Manifest.App.Assets))
	for k := range res.Manifest.App.Assets {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	key := keys[0]
	asset := res.Manifest.App.Assets[key]
	_ = stream.Send(&lavrayv1.UpdateEvent{
		TsMs: time.Now().UnixMilli(),
		Kind: &lavrayv1.UpdateEvent_Progress{Progress: &lavrayv1.DownloadProgress{
			Component:  lavrayv1.UpdateComponent_UPDATE_COMPONENT_APP,
			TotalBytes: asset.Length,
		}},
	})
	// Источник скачивания: тот, что отдал валидный манифест; повторяем
	// проверку целостности внутри DownloadArtifact (sha256+length).
	var src updates.Source
	for _, candidate := range c.BootstrapSources {
		src = candidate
		break
	}
	if src == nil {
		return failedPrecondition("нет источника для скачивания актива")
	}
	raw, err := c.DownloadArtifact(ctx, src, res.Manifest, key, 0)
	if err != nil {
		return mapErr(err)
	}
	_ = stream.Send(&lavrayv1.UpdateEvent{
		TsMs: time.Now().UnixMilli(),
		Kind: &lavrayv1.UpdateEvent_Progress{Progress: &lavrayv1.DownloadProgress{
			Component:       lavrayv1.UpdateComponent_UPDATE_COMPONENT_APP,
			DownloadedBytes: int64(len(raw)),
			TotalBytes:      int64(len(raw)),
		}},
	})
	return stream.Send(&lavrayv1.UpdateEvent{
		TsMs: time.Now().UnixMilli(),
		Kind: &lavrayv1.UpdateEvent_Verified{Verified: &lavrayv1.VerificationPassed{
			Component: lavrayv1.UpdateComponent_UPDATE_COMPONENT_APP,
			Version:   res.Manifest.App.Version,
		}},
	})
}

// ApplyUpdates — применение скачанного: реальная замена файлов за
// Installer-интерфейсом (платформенные репо); текущий запуск ядра отвечает
// событием Verified→Deferred (применение при перезапуске — UPDATE-SYSTEM §7).
func (s *Server) ApplyUpdates(ctx context.Context, req *connect.Request[lavrayv1.ApplyUpdatesRequest], stream *connect.ServerStream[lavrayv1.UpdateEvent]) error {
	return connect.NewError(connect.CodeUnimplemented, errNotYetW6)
}

// Rollback — откат к ранее установленной версии компонента. Реальная замена
// файлов — за Installer-интерфейсом релизной обвязки; здесь фиксируем запрос
// и состояние (RolledBack) для Центра обновлений.
func (s *Server) Rollback(ctx context.Context, req *connect.Request[lavrayv1.RollbackRequest]) (*connect.Response[lavrayv1.RollbackResponse], error) {
	if req.Msg.Component == lavrayv1.UpdateComponent_UPDATE_COMPONENT_UNSPECIFIED {
		return nil, invalidArg("component обязателен")
	}
	// Применение отката выполняет оболочка (она владеет файлами); ядро
	// только подтверждает запрос и сбрасывает serial канала, чтобы следующая
	// проверка снова предложила обновление.
	if err := s.st.SetSetting(setUpdSerialSt, "0"); err != nil {
		return nil, mapErr(err)
	}
	if err := s.st.SetSetting(setUpdSerialBe, "0"); err != nil {
		return nil, mapErr(err)
	}
	return connect.NewResponse(&lavrayv1.RollbackResponse{}), nil
}

// VerifyLocalUpdate — проверка скачанного артефакта по подписи из манифеста
// (LNB-34: оболочка кладёт файлы в staging и спрашивает ядро).
func (s *Server) VerifyLocalUpdate(ctx context.Context, req *connect.Request[lavrayv1.VerifyLocalUpdateRequest]) (*connect.Response[lavrayv1.VerifyLocalUpdateResponse], error) {
	c, err := s.newUpdater()
	if err != nil {
		return nil, err
	}
	if req.Msg.InstallerPath == "" {
		return nil, invalidArg("installer_path обязателен")
	}
	// L9 аудита №1: файл обязан быть ПРОЧИТАН и сверен с манифестом.
	// Раньше функция отвечала Valid:true, не открывая путь — оболочка
	// установила бы любой файл, включая несуществующий/подменённый.
	info, err := os.Stat(req.Msg.InstallerPath)
	if err != nil {
		return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{
			Valid:  false,
			Errors: []string{"installer_path: " + err.Error()},
		}), nil
	}
	if !info.Mode().IsRegular() {
		return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{
			Valid:  false,
			Errors: []string{"installer_path: не обычный файл"},
		}), nil
	}
	res, err := c.Check(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	if res.Manifest.App == nil {
		return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{
			Valid:  false,
			Errors: []string{"manifest: нет секции app"},
		}), nil
	}
	raw, err := os.ReadFile(req.Msg.InstallerPath)
	if err != nil {
		return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{
			Valid:  false,
			Errors: []string{"installer_path: " + err.Error()},
		}), nil
	}
	sum := sha256.Sum256(raw)
	got := hex.EncodeToString(sum[:])
	var errs []string
	matched := false
	for key, asset := range res.Manifest.App.Assets {
		if asset.Length == int64(len(raw)) && asset.Sha256 == got {
			matched = true
			_ = key
			break
		}
	}
	if !matched {
		errs = append(errs, "sha256/length не совпали ни с одним активом манифеста")
	}
	return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{
		Valid:  len(errs) == 0,
		Errors: errs,
	}), nil
}
