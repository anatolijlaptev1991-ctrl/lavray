// SPDX-License-Identifier: GPL-3.0-only

// update_local.go — VerifyLocalUpdate: офлайн-путь «Установить из файла».
// Установщик уже скопирован оболочкой в staging (путь вне staging — INVALID_ARGUMENT).
// Подпись берётся из файла .minisig рядом (или minisig_path), а без него — из
// манифеста онлайн-проверки. Проверяются подпись роли artifact, продукт,
// платформа и версия: файл не новее установленной версии — valid=false.
package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"

	"connectrpc.com/connect"

	lavrayv1 "github.com/anatolijlaptev1991-ctrl/lavray/core/internal/gen/lavrayv1"
	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/updates"
)

func (s *Server) VerifyLocalUpdate(ctx context.Context, req *connect.Request[lavrayv1.VerifyLocalUpdateRequest]) (*connect.Response[lavrayv1.VerifyLocalUpdateResponse], error) {
	if req.Msg.InstallerPath == "" {
		return nil, invalidArg("installer_path обязателен")
	}
	installer, err := updates.InsideStaging(s.stagingDir(), req.Msg.InstallerPath)
	if err != nil {
		return nil, invalidArg("installer_path: %v", err)
	}
	sigPath := installer + updates.MinisigSuffix
	if req.Msg.MinisigPath != "" {
		if sigPath, err = updates.InsideStaging(s.stagingDir(), req.Msg.MinisigPath); err != nil {
			return nil, invalidArg("minisig_path: %v", err)
		}
	}
	c, _, err := s.updateClient(lavrayv1.UpdateChannel_UPDATE_CHANNEL_STABLE)
	if err != nil {
		return nil, updateErr(err)
	}
	claims, verr := s.verifyLocalFile(ctx, c, installer, sigPath)
	if verr != nil {
		return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{Errors: []string{verr.Error()}}), nil
	}
	return connect.NewResponse(&lavrayv1.VerifyLocalUpdateResponse{Valid: true, Manifest: &lavrayv1.UpdateManifest{
		Product: claims.Product, Version: claims.Version, Serial: claims.Serial,
		Channel: protoChannel(claims.Channel)}}), nil
}

func protoChannel(ch string) lavrayv1.UpdateChannel {
	if ch == updates.ChannelBeta {
		return lavrayv1.UpdateChannel_UPDATE_CHANNEL_BETA
	}
	return lavrayv1.UpdateChannel_UPDATE_CHANNEL_STABLE
}

// verifyLocalFile проверяет файл целиком и возвращает подписанные заявления.
func (s *Server) verifyLocalFile(ctx context.Context, c *updates.Client, installer, sigPath string) (updates.ArtifactClaims, error) {
	sha, digest, size, err := hashInstaller(installer)
	if err != nil {
		return updates.ArtifactClaims{}, fmt.Errorf("installer_path: %w", err)
	}
	text, err := os.ReadFile(sigPath)
	if err != nil {
		if text, err = s.signatureFromManifest(ctx, c, sha, size); err != nil {
			return updates.ArtifactClaims{}, err
		}
	}
	sig, err := updates.ParseMinisig(text)
	if err != nil {
		return updates.ArtifactClaims{}, err
	}
	claims, err := updates.ParseClaims(sig.TrustedComment)
	if err != nil {
		return claims, err
	}
	if err := c.Trust.Root().VerifyArtifactSignature(sig, digest, claims); err != nil {
		return claims, err
	}
	return claims, s.checkLocalPolicy(c, claims)
}

// checkLocalPolicy: продукт и платформа свои, версия строго новее установленной.
func (s *Server) checkLocalPolicy(c *updates.Client, cl updates.ArtifactClaims) error {
	switch {
	case c.Product != "" && cl.Product != c.Product:
		return fmt.Errorf("%w: файл для продукта %q", updates.ErrWrongProduct, cl.Product)
	case cl.Platform != platformOf(c):
		return fmt.Errorf("файл для платформы %q, а здесь %q", cl.Platform, platformOf(c))
	case updates.CompareVersions(cl.Version, s.upd.appVersion()) <= 0:
		return fmt.Errorf("версия файла %s не новее установленной %s", cl.Version, s.upd.appVersion())
	}
	return nil
}

func platformOf(c *updates.Client) string {
	if c.Platform != "" {
		return c.Platform
	}
	return updates.CurrentAssetKey()
}

// signatureFromManifest: подписи рядом нет — ищем актив с тем же sha256 в
// манифесте онлайн-проверки (нужна сеть и действующая цепочка).
func (s *Server) signatureFromManifest(ctx context.Context, c *updates.Client, sha string, size int64) ([]byte, error) {
	res, err := c.Check(ctx)
	if err != nil || res.Manifest == nil || res.Manifest.App == nil {
		return nil, fmt.Errorf("рядом с установщиком нет файла .minisig, а манифест недоступен")
	}
	for _, a := range res.Manifest.App.Assets {
		if a.Sha256 == sha && a.Length == size {
			return []byte(a.Minisig), nil
		}
	}
	return nil, fmt.Errorf("рядом с установщиком нет файла .minisig, а в манифесте нет такого файла")
}

// hashInstaller — sha256 (hex), BLAKE2b-512 и размер файла за один проход.
func hashInstaller(p string) (string, [updates.DigestSize]byte, int64, error) {
	var d [updates.DigestSize]byte
	f, err := os.Open(p)
	if err != nil {
		return "", d, 0, err
	}
	defer f.Close()
	sum, b2 := sha256.New(), updates.NewBlake2b()
	n, err := io.Copy(io.MultiWriter(sum, b2), io.LimitReader(f, updates.MaxArtifactBytes+1))
	if err != nil {
		return "", d, 0, err
	}
	if n > updates.MaxArtifactBytes {
		return "", d, 0, updates.ErrTooLarge
	}
	copy(d[:], b2.Sum(nil))
	return hex.EncodeToString(sum.Sum(nil)), d, n, nil
}
