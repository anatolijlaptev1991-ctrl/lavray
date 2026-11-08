// SPDX-License-Identifier: GPL-3.0-only

package store

// profiles_page.go — страничный список профилей (R0-D): отбор и страница
// выполняются до декодирования JSON; полная модель собирается только для
// строк страницы. Порядок и состав — те же, что у ListProfiles + фильтров API.

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/anatolijlaptev1991-ctrl/lavray/core/internal/model"
)

// ProfileQuery — отбор профилей. GroupID < 0 — все группы. SearchLower —
// строка, УЖЕ приведённая strings.ToLower (регистр Unicode считает Go, не
// SQLite: LOWER/LIKE в SQLite знают только ASCII). Limit < 0 — без предела.
type ProfileQuery struct {
	GroupID       int64
	SearchLower   string
	FavoritesOnly bool
	TagsAnyOf     []string
	Offset, Limit int64
}

// lightProfile — поля, нужные только для отбора (без декодирования data).
type lightProfile struct {
	id                 int64
	name, address, typ string
	tagsJSON           sql.NullString
}

const pageIDChunk = 500

// ListProfilesPage возвращает страницу профилей и общее число подходящих.
func (s *Store) ListProfilesPage(q ProfileQuery) ([]*model.Profile, int64, error) {
	where, args := q.sqlWhere()
	if q.SearchLower == "" && len(q.TagsAnyOf) == 0 {
		return s.pageBySQL(where, args, q)
	}
	ids, err := s.matchIDs(where, args, q)
	if err != nil {
		return nil, 0, err
	}
	total := int64(len(ids))
	from := min(max(q.Offset, 0), total)
	to := total
	if q.Limit >= 0 && from+q.Limit < to {
		to = from + q.Limit
	}
	out, err := s.profilesByIDs(ids[from:to])
	return out, total, err
}

func (q ProfileQuery) sqlWhere() (string, []any) {
	var conds []string
	var args []any
	if q.GroupID >= 0 {
		conds = append(conds, `group_id = ?`)
		args = append(args, q.GroupID)
	}
	if q.FavoritesOnly {
		conds = append(conds, `favorite <> 0`)
	}
	if len(conds) == 0 {
		return "", args
	}
	return ` WHERE ` + strings.Join(conds, ` AND `), args
}

const profileOrder = ` ORDER BY group_id, sort_key, id`

// pageBySQL — без поиска и тегов: счёт и страница целиком в SQL.
func (s *Store) pageBySQL(where string, args []any, q ProfileQuery) ([]*model.Profile, int64, error) {
	var total int64
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM profiles`+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	pageArgs := append(append([]any{}, args...), q.Limit, max(q.Offset, 0))
	rows, err := s.db.Query(`SELECT `+profileCols+` FROM profiles`+where+profileOrder+` LIMIT ? OFFSET ?`, pageArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out, err := scanProfiles(rows)
	return out, total, err
}

// matchIDs — id подходящих профилей в каноническом порядке. Теги берутся из
// data одним json_extract и разбираются как []string — та же семантика, что и
// у полного Unmarshal, но без разбора остальной модели.
func (s *Store) matchIDs(where string, args []any, q ProfileQuery) ([]int64, error) {
	tagsCol := `NULL`
	if len(q.TagsAnyOf) > 0 {
		tagsCol = `json_extract(data, '$.tags')`
	}
	rows, err := s.db.Query(`SELECT id, name, address, type, `+tagsCol+` FROM profiles`+where+profileOrder, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var lp lightProfile
		if err := rows.Scan(&lp.id, &lp.name, &lp.address, &lp.typ, &lp.tagsJSON); err != nil {
			return nil, err
		}
		ok, err := lp.matches(q)
		if err != nil {
			return nil, err
		}
		if ok {
			ids = append(ids, lp.id)
		}
	}
	return ids, rows.Err()
}

func (lp lightProfile) matches(q ProfileQuery) (bool, error) {
	if q.SearchLower != "" &&
		!strings.Contains(strings.ToLower(lp.name), q.SearchLower) &&
		!strings.Contains(strings.ToLower(lp.address), q.SearchLower) &&
		!strings.Contains(strings.ToLower(lp.typ), q.SearchLower) {
		return false, nil
	}
	if len(q.TagsAnyOf) == 0 {
		return true, nil
	}
	var have []string
	if lp.tagsJSON.Valid {
		if err := json.Unmarshal([]byte(lp.tagsJSON.String), &have); err != nil {
			return false, fmt.Errorf("store: decode profile tags: %w", err)
		}
	}
	for _, h := range have {
		for _, w := range q.TagsAnyOf {
			if h == w {
				return true, nil
			}
		}
	}
	return false, nil
}

// profilesByIDs читает полные профили страницы, сохраняя порядок ids.
func (s *Store) profilesByIDs(ids []int64) ([]*model.Profile, error) {
	byID := make(map[int64]*model.Profile, len(ids))
	for start := 0; start < len(ids); start += pageIDChunk {
		chunk := ids[start:min(len(ids), start+pageIDChunk)]
		args := make([]any, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}
		rows, err := s.db.Query(`SELECT `+profileCols+` FROM profiles WHERE id IN (?`+strings.Repeat(`,?`, len(chunk)-1)+`)`, args...)
		if err != nil {
			return nil, err
		}
		ps, err := scanProfiles(rows)
		rows.Close()
		if err != nil {
			return nil, err
		}
		for _, p := range ps {
			byID[p.ID] = p
		}
	}
	out := make([]*model.Profile, 0, len(ids))
	for _, id := range ids {
		if p := byID[id]; p != nil {
			out = append(out, p)
		}
	}
	return out, nil
}

func scanProfiles(rows *sql.Rows) ([]*model.Profile, error) {
	var out []*model.Profile
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}
