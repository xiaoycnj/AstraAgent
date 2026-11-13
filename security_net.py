"""Direct, DNS-pinned upstream transport with no inherited proxy credentials."""
import http.client
import ipaddress
import socket
from urllib.parse import urlsplit
from urllib.request import HTTPHandler, HTTPSHandler, ProxyHandler, build_opener


def validate_url(url):
    parts = urlsplit(url)
    if parts.scheme not in ('https', 'http') or not parts.hostname or parts.username or parts.password:
        raise ValueError('接口地址必须为无账号信息的 HTTPS 地址')
    if parts.fragment or parts.query:
        raise ValueError('接口地址不能包含查询参数或片段')
    loopback = parts.hostname.lower() == 'localhost'
    try:
        loopback = ipaddress.ip_address(parts.hostname).is_loopback
    except ValueError:
        pass
    if parts.scheme == 'http' and not loopback:
        raise ValueError('远程接口必须使用 HTTPS，本机 localhost/回环地址可以使用 HTTP')
    return parts


def addresses(host, port, allow_private=False):
    results = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    clean = []
    for family, kind, protocol, _, address in results:
        ip = ipaddress.ip_address(address[0])
        ip = ip.ipv4_mapped if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped else ip
        if ip.is_unspecified or ip.is_multicast or ip.is_link_local or (ip.is_reserved and not ip.is_loopback):
            raise ValueError('禁止访问元数据、链路本地、未指定或多播地址')
        if not ip.is_global and not ip.is_loopback and not allow_private:
            raise ValueError('此接口解析到私有网络，需要在服务商设置中显式允许私有网络')
        clean.append((family, kind, protocol, address))
    if not clean:
        raise ValueError('无法解析服务商地址')
    return clean


def opener(*handlers, allow_private=False, allow_query=False, allow_loopback=True):
    class PinnedHTTP(http.client.HTTPConnection):
        def connect(self):
            self.sock = connect(self.host, self.port, self.timeout, loopback_only=True)

    class PinnedHTTPS(http.client.HTTPSConnection):
        def connect(self):
            raw = connect(self.host, self.port, self.timeout)
            try:
                self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
            except BaseException:
                raw.close()
                raise

    def connect(host, port, timeout, loopback_only=False):
        errors = []
        for family, kind, protocol, address in addresses(host, port, allow_private):
            resolved=ipaddress.ip_address(address[0])
            if isinstance(resolved,ipaddress.IPv6Address) and resolved.ipv4_mapped:
                resolved=resolved.ipv4_mapped
            if not allow_loopback and resolved.is_loopback:
                raise ValueError('此下载不允许访问本机回环地址')
            if loopback_only and not resolved.is_loopback:
                raise ValueError('HTTP 仅允许本机回环连接')
            stream = socket.socket(family, kind, protocol)
            stream.settimeout(timeout)
            try:
                stream.connect(address)
                return stream
            except OSError as error:
                errors.append(error)
                stream.close()
        raise errors[-1]

    class HTTP(HTTPHandler):
        def http_open(self, request):
            from urllib.parse import urlunsplit
            parts=urlsplit(request.full_url)
            validate_url(urlunsplit(parts._replace(query='')) if allow_query else request.full_url)
            return self.do_open(PinnedHTTP, request)

    class HTTPS(HTTPSHandler):
        def https_open(self, request):
            from urllib.parse import urlunsplit
            parts=urlsplit(request.full_url)
            validate_url(urlunsplit(parts._replace(query='')) if allow_query else request.full_url)
            return self.do_open(PinnedHTTPS, request, context=self._context)

    return build_opener(ProxyHandler({}), HTTP(), HTTPS(), *handlers)
