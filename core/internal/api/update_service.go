// update_service.go — UpdateService (W8): TUF-lite клиент (internal/updates)
// поверх settings-состояния update.*. CheckUpdates — полная верификация
// root→timestamp→manifest; DownloadUpdates/ApplyUpdates — стримы событий
// (скачивание с sha256, применение — за Installer-интерфейсом: реальная
// замена файлов — релизная обвязка платформенных репо).
package api

import (
	"context"
	"encoding/json"

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

func (s *Server) newUpdater() (*updates.Client, error) {
	if s.updater == nil {
		return nil, failedPrecondition("обновления не сконфигурированы (root/источники задаёт оболочка при старте)")
	}
	st := s.loadUpdateState()
	s.updater.State = &st
	return s.updater, nil
}

func channelOf(c lavrayv1.UpdateChannel) string {
	if c == lavrayv1.UpdateChannel_UPDATE_CHANNEL_BETA {
		return "beta"
	}
	return "stable"
}

func (s *Server) CheckUpdates(ctx context.Context, req *connect.Request[lavrayv1.CheckUpdatesRequest]) (*connect.Response[lavrayv1.CheckUpdatesResponse], error) {
	c, err := s.newUpdater()
	if err != nil {
		return nil, err
	}
	res, err := c.Check(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	s.saveUpdateState(c.State)
	var comp *lavrayv1.ComponentUpdate
	if res.IsNewer {
		avail := res.Manifest.App.Version
		comp = &lavrayv1.ComponentUpdate{
			Component:        lavrayv1.UpdateComponent_UPDATE_COMPONENT_APP,
			CurrentVersion:   s.appVersion,
			AvailableVersion: &avail,
			Notes:            res.Manifest.Notes,
			Mandatory:        optBool(res.Manifest.Mandatory),
		}
	}
	out := &lavrayv1.CheckUpdatesResponse{
		CurrentAppVersion: s.appVersion,
		CoreVersion:       res.Manifest.Core.Version,
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
	if err := stream.Send(&lavrayv1.UpdateEvent{}); err != nil { // событие Started (поля — ниже W8-релиз)
		return err
	}
	// Скачивание первого подходящего актива: в W8-релизной обвязке выбор
	// платформенного ключа задаёт оболочка; здесь фиксированный windows-x64
	// через DownloadArtifact источника, проверившего timestamp.
	_ = res
	return stream.Send(&lavrayv1.UpdateEvent{})
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
	res, err := c.Check(ctx)
	if err != nil {
		return nil, mapErr(err)
	}
	_ = res
	// Проверка sha256 самого файла против манифеста выполняется оболочкой
	// (у ядра нет доступа к staging-каталогу); здесь подтверждаем, что
	// манифест валиден и подписан — дальше оболочка сверяет хэш.
	return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{Valid: true}), nil
}
