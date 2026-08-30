package v1

import (
	"net/http"

	"github.com/labstack/echo/v5"

	"github.com/usememos/memos/internal/dictionary"
	"github.com/usememos/memos/server/auth"
)

type dictionaryEntryResponse struct {
	Configured bool              `json:"configured"`
	Entry      *dictionary.Entry `json:"entry,omitempty"`
}

// RegisterDictionaryRoutes registers dictionary lookup routes.
func (s *APIV1Service) RegisterDictionaryRoutes(echoServer *echo.Echo) {
	authenticator := auth.NewAuthenticator(s.Store, s.Secret)
	apiGroup := echoServer.Group("/api/v1")
	apiGroup.GET("/dictionary/entries/:word", func(c *echo.Context) error {
		return s.lookupDictionaryEntry(c, authenticator)
	})
}

func (s *APIV1Service) lookupDictionaryEntry(c *echo.Context, authenticator *auth.Authenticator) error {
	user, err := authenticator.AuthenticateToUser(
		c.Request().Context(),
		c.Request().Header.Get(echo.HeaderAuthorization),
		c.Request().Header.Get("Cookie"),
	)
	if err != nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "failed authentication").Wrap(err)
	}
	if user == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "authentication required")
	}

	entry, configured, err := dictionary.Lookup(c.Request().Context(), s.Profile.Data, c.Param("word"))
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to lookup dictionary entry").Wrap(err)
	}
	return c.JSON(http.StatusOK, &dictionaryEntryResponse{
		Configured: configured,
		Entry:      entry,
	})
}
